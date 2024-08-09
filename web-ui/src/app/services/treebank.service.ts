import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, ReplaySubject, EMPTY } from 'rxjs';
import { mergeMap, catchError, shareReplay, map, first } from 'rxjs/operators';

import {
    Treebank,
    TreebankComponent,
    TreebankComponents,
    TreebankDetails,
    TreebankMetadata
} from '../treebank';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';


export interface TreebankLookup {
    providers: { name: string, corpora: Set<string> }[];
    data: {
        [provider: string]: {
            [corpus: string]: Treebank;
        }
    };
}
export interface ConfiguredTreebanksResponse {
    [treebank: string]: {
        components: {
            [component: string]: {
                id: string,
                title: string,
                description: string,
                sentences: number | '?',
                words: number | '?',
                group?: string,
                variant?: string,
                disabled?: boolean
            }
        },
        groups?: {
            [group: string]: {
                description: string
            }
        },
        variants?: {
            [variant: string]: {
                display: string
            }
        },
        description: string,
        title: string,
        metadata: {
            field: string,
            type: 'text' | 'int' | 'date',
            facet: 'checkbox' | 'slider' | 'range' | 'dropdown',
            show: boolean,
            minValue?: number | Date,
            maxValue?: number | Date,
        }[],
        multioption?: boolean
    };
}

export interface DjangoTreebankResponse {
    slug: string;
    title: string;
    description: string;
    url_more_info: string;
}

interface DjangoTreebankMetadataResponse {
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'range';
    min_value: string | null;
    max_value: string | null;
}

export interface DjangoComponentsForTreebankResponse {
    slug: string;
    title: string;
    description: string;
    nr_sentences: string;
    nr_words: string;
}

class LazyRetrieve<T> {
    value?: Promise<T | undefined>;
    get(): Promise<T | undefined> {
        return this.value || (this.value = this.retriever()
            .catch((reason: HttpErrorResponse) => {
                NotificationService.addError(reason);
                return undefined;
            }));
    }

    constructor(private retriever: () => Promise<T>) {
        this.get = this.get.bind(this);
    }
}

abstract class TreebankBase implements Treebank {
    provider: string; id: string;
    displayName: string;
    description?: string;
    multiOption: boolean;
    isPublic: boolean;
    userId?: number;
    email?: string;
    uploaded?: Date;
    processed?: Date;
    details: { [T in keyof TreebankDetails]: () => Promise<TreebankDetails[T] | undefined> };
}

class LazyTreebank extends TreebankBase {
    constructor(
        values: Omit<Treebank, 'details'>,
        retrievers: {
            [T in keyof Treebank['details']]: Treebank['details'][T]
        }) {
        super();
        Object.assign(this, values);

        this.details = {
            metadata: new LazyRetrieve(retrievers.metadata).get,
            components: new LazyRetrieve(retrievers.components).get,
            componentGroups: new LazyRetrieve(retrievers.componentGroups).get,
            variants: new LazyRetrieve(retrievers.variants).get
        };
    }
}

export class ReadyTreebank extends TreebankBase {
    constructor(
        values: Omit<Treebank, 'details'>,
        details: TreebankDetails) {
        super();
        Object.assign(this, values);

        this.details = {
            metadata: () => Promise.resolve(details.metadata),
            components: () => Promise.resolve(details.components),
            componentGroups: () => Promise.resolve(details.componentGroups),
            variants: () => Promise.resolve(details.variants)
        };
    }
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
        sentenceCount: parseInt(comp.nr_sentences, 10),
        title: comp.title,
        wordCount: parseInt(comp.nr_words, 10),

        group: undefined,
        variant: undefined,
    }
}

function makeDjangoTreebank(bank: DjangoTreebankResponse) {
    return {
        id: bank.slug,
        displayName: bank.title,
        description: bank.description,
        isPublic: true,
        multiOption: true,
        provider: 'gretel',
    }
}

@Injectable()
export class TreebankService {
    /**
     * Use getTreebanks to start loading.
     * Some treebanks may become available here before it is done.
     */
    public readonly treebanks = new BehaviorSubject<TreebankLookup>({ providers: [], data: {} });

    private treebanksLoader: Promise<void>;

    constructor(private configurationService: ConfigurationService, private http: HttpClient) {
    }

    public async get(provider: string, corpus: string) {
        const get = (treebankLookup: TreebankLookup) => {
            const treebanks = treebankLookup.data[provider];
            return treebanks && treebanks[corpus];
        };

        return get(this.treebanks.value) || this.getTreebanks() && this.treebanks.pipe(
            map(treebanks => get(treebanks)),
            first(treebank => !!treebank)).toPromise();
    }

    /**
     * Completes when all providers have been queried.
     */
    public async getTreebanks(): Promise<TreebankLookup> {
        if (!this.treebanksLoader) {
            this.treebanksLoader = this.loadAll();
        }
        await this.treebanksLoader;
        return this.treebanks.value;
    }

    private async loadAll() {
        const allTreebanks$ = this.getDjangoTreebanks().pipe(shareReplay());
        allTreebanks$.subscribe((treebank) => {
            if (treebank) {
                const current = this.treebanks.value;
                const provider = current.providers.find(p => p.name === treebank.provider);
                if (provider) {
                    provider.corpora.add(treebank.id);
                } else {
                    current.providers.push({ name: treebank.provider, corpora: new Set([treebank.id]) });
                }
                this.treebanks.next({
                    providers: current.providers,
                    data: {
                        ...current.data,
                        [treebank.provider]: {
                            ...current.data[treebank.provider],
                            [treebank.id]: treebank
                        }
                    }
                });
            }
        });

        // toPromise() resolves only when the underlying stream completes.
        await allTreebanks$.toPromise();
    }

    private getDjangoTreebanks(): Observable<Treebank> {
        const ob = new ReplaySubject<Treebank>();

        // Not working with providers for now

        (async () => {
            const djangoUrl = await this.configurationService.getDjangoUrl('treebanks/treebank/');

            this.http.get<DjangoTreebankResponse[]>(djangoUrl)
                .pipe(
                    mergeMap(r => r),
                    map(r => this.getDjangoTreebank(r)),
                    catchError((error: HttpErrorResponse) => {
                        NotificationService.addError(error);
                        return EMPTY;
                    })
                )
                .subscribe(ob);
        })();
        
        return ob;
    }

    private getDjangoTreebank(bank: DjangoTreebankResponse): Treebank {
        return new LazyTreebank(
            makeDjangoTreebank(bank),
            {
                metadata: async () => {
                    const djangoMetadata = await this.configurationService.getDjangoUrl('treebanks/treebank/' + bank.slug + '/metadata/')
                        .then(url => this.http.get<{'metadata': DjangoTreebankMetadataResponse[]}>(url, { }).toPromise());
                    return djangoMetadata.metadata.map(makeDjangoMetadata);
                },
                componentGroups: async () => undefined,
                components: async () => {
                    const djangoComponents = await this.configurationService.getDjangoUrl('treebanks/treebank/' + bank.slug + '/components/')
                        .then(url => this.http.get<DjangoComponentsForTreebankResponse[]>(url, {  }).toPromise());
                    
                    const components: TreebankComponent[] = djangoComponents.map(makeDjangoComponent);
                    return components.reduce<TreebankComponents>((cs, c) => { cs[c.id] = c; return cs; }, {});
                },
                variants: async () => undefined,
            }
        )
    }
}
