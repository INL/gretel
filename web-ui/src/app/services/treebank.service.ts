import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, combineLatest, EMPTY, firstValueFrom, forkJoin, from, merge, Observable, ReplaySubject } from 'rxjs';
import { catchError, debounceTime, filter, map, mergeMap, scan, switchMap, tap } from 'rxjs/operators';

import {
    ComponentGroup,
    FuzzyNumber,
    Treebank,
    TreebankComponent,
    TreebankLoaded,
    TreebankMetadata,
    TreebankStub,
    TreebankVariant
} from '../treebank';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';


namespace Legacy {
    export interface LegacyUploadedTreebankReponse {
        id: string,
        title: string,
        /** A number usually */
        user_id: string, 
        email: string,
        /** Date string in the form of "2021-06-13 12:30:09" */
        uploaded: string,
        /** Date string in the form of "2021-06-13 12:30:09" */
        processed: string,
        /** "1" for public ("0" for not public?) */
        public: string
    }
    

    interface LegacyUploadedTreebankMetadataResponse {
        id: string;
        treebank_id: string;
        field: string;
        type: 'text' | 'int' | 'date';
        facet: 'checkbox' | 'slider' | 'date_range';
        min_value: string | null;
        max_value: string | null;
        show: '1' | '0';
    }

}


namespace Federated {

}

// not quite sure what this is yet
interface UploadedTreebankShowResponse {
    basex_db: string;
    nr_sentences: string;
    nr_words: string;
    slug: string;
    title: string;
}


/** For federated providers that haven't updated */
export interface LegacyTreebankResponse {

}

export interface DjangoTreebankResponse {
    slug: string;
    title: string;
    description: string;
    url_more_info: string;
    variants: string[];
    groups: Array<{
        slug: string;
        description: string;
    }>
}

export interface DjangoTreebankMetadataResponse {
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'range';
    min_value: string | null;
    max_value: string | null;
}

export type DjangoComponentsForTreebankResponse = {
    slug: string;
    title: string;
    description: string;
    nr_sentences: number;
    nr_words: number;
    /** Empty string if not in a group */
    group: string;
    /** Empty string if not a variant */
    variant: string;
}

function makeDjangoMetadata(item: DjangoTreebankMetadataResponse): TreebankMetadata {
    const metadata: TreebankMetadata = {
        field: item.field,
        type: item.type,
        facet: item.facet,
        show: true
    }

    if (['slider', 'range'].includes(metadata.facet)) {
        switch (metadata.type) {
            case 'int':
                metadata.minValue = parseInt(item.min_value, 10);
                metadata.maxValue = parseInt(item.max_value, 10);
                return metadata;
            case 'date':
                metadata.minValue = new Date(item.min_value);
                metadata.maxValue = new Date(item.max_value);
                return metadata;
        }
    }

    return metadata;
}

function makeDjangoComponent(comp: DjangoComponentsForTreebankResponse): TreebankComponent {
    return {
        description: comp.description,
        disabled: false,
        id: comp.slug,
        sentenceCount: new FuzzyNumber(comp.nr_sentences),
        title: comp.title,
        wordCount: new FuzzyNumber(comp.nr_words),
        group: comp.group || undefined,
        variant: comp.variant || undefined,
    }
}


/** 
* Map the treebank components returned by the django backend to something the interface can use. 
* @returns an object with the components, componentGroups, variants, word and sentence counts for the treebank as properties.
*/
const makeDjangoComponents = (treebank: TreebankStub, componentsFromServer: DjangoComponentsForTreebankResponse[]): 
    Pick<TreebankLoaded, 'components'|'variants'|'componentGroups'|'wordCount'|'sentenceCount'> => {  
    /*
    * The groups and variants of components form a 2d grid.
    * So every variant should occur (at most) once in every group, and every group should occur once (at most) for every variant.
    * Some combinations may be empty. 
    * 
    * We pre-process this data a little to the interface doesn't have to do lookups and can just render the grid/table.
    * This means that the order of the components is important when looking at them from the group/variant perspective.
    * E.g. this is our data model:
    *              Variant_a | Variant_b
    * Group_1  |  Component1 | Component2
    * Group_2  |  Component3 | Component4
    * 
    * Every group contains an array with all variants, in the same order every time.
    * Every variant contains an array with all components (one per group), in the same order every time.
    * So that the component at position i in any variant has the same group (e.g. variant_a.components[i].group === variant_b.components[i].group)
    * And the component at position i in any group has the same variant (e.g. group_1.components[i].variant === group_2.components[i].variant)
    */
    const componentGroups: Array<ComponentGroup&{index: number}> = treebank.groups
        .map((g, index) => ({
            index,
            id: g.slug, 
            description: g.description, 
            sentenceCount: new FuzzyNumber(), 
            wordCount: new FuzzyNumber(), 
            components: []
        }));
    const variants: Array<TreebankVariant&{index: number}> = treebank.variants
        .map<TreebankVariant&{index: number}>((v, index) => ({
            index,
            id: v, sentenceCount: new FuzzyNumber(), 
            wordCount: new FuzzyNumber(), 
            components: []
        }));

    /** Total words in the treebank */
    const totalWordCount = new FuzzyNumber();
    /** Total sentences in the treebank */
    const totalSentenceCount = new FuzzyNumber();
    
    const components: Record<string, TreebankComponent> = {};
    for (const c of componentsFromServer.map(makeDjangoComponent)) {
        components[c.id] = c;
        totalSentenceCount.add(c.sentenceCount);
        totalWordCount.add(c.wordCount);

        const group = c.group && componentGroups.find(g => g.id === c.group);
        const variant = c.variant && variants.find(v => v.id === c.variant);
        if (group) {
            group.sentenceCount.add(c.sentenceCount);
            group.wordCount.add(c.wordCount);
            if (variant) group.components[variant.index] = c;
        }
        if (variant) {
            variant.sentenceCount.add(c.sentenceCount);
            variant.wordCount.add(c.wordCount);
            if (group) variant.components[group.index] = c;
        }
    }

   return {
        components,
        componentGroups,
        variants,
        sentenceCount: totalSentenceCount,
        wordCount: totalWordCount
   }
}

const makeDjangoTreebank = (bank: DjangoTreebankResponse): TreebankStub => ({
    provider: 'gretel',
    id: bank.slug,
    displayName: bank.title,
    description: bank.description,
    helpUrl: bank.url_more_info,
    multiOption: true,
    isPublic: true,
    userId: undefined,
    email: undefined,
    processed: new Date(),
    uploaded: undefined,
    loaded: false,
    // There was a bug with groups where the server sometimes returns {} instead of [].
    // Guard against this.
    groups: Array.isArray(bank.groups) ? bank.groups : [],
    variants: Array.isArray(bank.variants) ? bank.variants : [],
});

@Injectable()
export class TreebankService {
    /** Use a behaviorsubject so we can access the current value synchronously, which can be useful. */
    private _treebanks$ = new BehaviorSubject<Treebank[]>([]);
    /** Use a behaviorsubject so we can access the current value synchronously, which can be useful. */
    private _loading$ = new BehaviorSubject<boolean>(false);
    
    /** 
     * Any Treebanks put in this observable will 
     * trigger the service to load the metadata and components.
     * The enhanced treebank will be emitted on the treebankLoaded$ observable.
     */
    private loadTreebank$ = new ReplaySubject<TreebankStub>();
    private treebankLoaded$ = new ReplaySubject<TreebankLoaded>();
    
    /** Contains the most up-to-date version of every treebank in the system. Sorted by name then creation date. */
    public treebanks$: Observable<Array<Treebank|TreebankStub>> = this._treebanks$.asObservable().pipe(debounceTime(1000));
    public loading$: Observable<boolean> = this._loading$.asObservable();

    // Arrow function, prevent binding issues
    /** 
     * Given a treebank, fetch its metadata and components.
     * @param treebank the treebank to load
     * @returns a stream that will emit the treebank with the metadata and components added and 'loaded' set to true. 
     */
    private progressivelyEnhanceTreebank = (treebank: TreebankStub): Observable<TreebankLoaded> => {
        // Fetch metadata and put in treebank when it comes in.
        // Then re-emit the treebank.
        const metadata$: Observable<TreebankMetadata[]> = 
            from(this.configurationService.getDjangoUrl('treebanks/treebank/' + treebank.id + '/metadata/'))
            .pipe(
                mergeMap(url => this.http.get<{'metadata': DjangoTreebankMetadataResponse[]}>(url)),
                map(r => r.metadata.map(makeDjangoMetadata)),
            );

        // Fetch components and put in treebank when they come in.
        // Then re-emit the treebank
        const components$: Observable<ReturnType<typeof makeDjangoComponents>> = 
            from(this.configurationService.getDjangoUrl('treebanks/treebank/' + treebank.id + '/components/'))
            .pipe(
                mergeMap(url => this.http.get<DjangoComponentsForTreebankResponse[]>(url)),
                map(c => makeDjangoComponents(treebank, c)),
            )

        return forkJoin([metadata$, components$])
        .pipe(map(([metadata, components]) => ({...treebank, metadata, ...components, loaded: true})))
    };

    public async loadTreebank(treebank: Treebank): Promise<TreebankLoaded> {
        if (treebank.loaded) return treebank;
        this.loadTreebank$.next(treebank as TreebankStub);
        return firstValueFrom(this.treebankLoaded$.pipe(filter(tb => tb.provider === treebank.provider && tb.id === treebank.id)));
    }

    constructor(
        private userService: UserService,
        private configurationService: ConfigurationService, 
        private http: HttpClient,
    ) {
        const url$ = from(configurationService.getDjangoUrl('treebanks/treebank/'))

        // Fetch the treebanks from the server and put them in a stream.
        // These won't contain metadata yet.
        const treebankStub$ = 
        combineLatest([userService.user$, url$]) 
        .pipe(
            tap(() => this._loading$.next(true)),
            switchMap(([user, url]) => this.http
                .get<DjangoTreebankResponse[]>(url)
                .pipe(
                    catchError((error: HttpErrorResponse) => { NotificationService.addError(error); return EMPTY; }),
                    map(treebanks => treebanks.map(makeDjangoTreebank)),
                )
            ),
            tap({ complete: () => this._loading$.next(false) })
        );

        // The application can request a treebank to load its metadata and components.
        // It will be put in the loadTreebank$ stream.
        // The progressivelyEnhanceTreebank function will then fetch the metadata and components
        // and put them in the treebank.
        // The treebank will then be emitted on the treebankLoaded$ stream.
        this.loadTreebank$
            .pipe(mergeMap(this.progressivelyEnhanceTreebank))
            .subscribe(this.treebankLoaded$);

        // Now merge the treebank stubs with the treebanks that have been loaded.
        merge(treebankStub$.pipe(mergeMap(tbs => from(tbs))), this.treebankLoaded$)
        .pipe(
            // then gather them in a deduped and sorted array.
            scan((acc: Record<string, Treebank>, treebank) => Object.assign(acc, {[treebank.id + '_' + treebank.provider]: treebank}), {}),
            map(treebanks => Object.values(treebanks).sort((a, b) => a.displayName.localeCompare(b.displayName) || new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime())),
        )
        // and send them out through the public treebanks$ observable.
        .subscribe(this._treebanks$);
    }

    // Assume we never return undefined, which should hold.
    public get(provider: string, corpus: string): Treebank {
        return this._treebanks$.value.find(tb => tb.provider === provider && tb.id === corpus) as Treebank;
    }

    public async getLoadedTreebank(provider: string, corpus: string): Promise<TreebankLoaded> {
        return this.loadTreebank(this.get(provider, corpus));
    }

    /** 
     * Util function that can take either an array of treebanks, or the selectedTreebanks object from the global state.
     * @returns A promise that resolves with the loaded versions of all passed treebanks.
     */
    public async getLoadedTreebanks(selection: 
        Array<
            {provider: string, id: string} | 
            {treebank: Treebank}
        >
    ): Promise<TreebankLoaded[]> {
        if (Array.isArray(selection)) {
            if (!selection.length) return [];

            if ('treebank' in selection[0]) {
                return Promise.all(
                    (selection as Array<{treebank: Treebank}>)
                    .map(s => this.getLoadedTreebank(s.treebank.provider, s.treebank.id))
                );
            } else if ('provider' in selection[0]) {
                return Promise.all(
                    (selection as Array<{provider: string, id: string}>)
                    .map(s => this.getLoadedTreebank(s.provider, s.id))
                );
            }
        } 
        return [];
    }
}
