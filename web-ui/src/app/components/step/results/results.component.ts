import { Component, Input, OnDestroy, Output, EventEmitter, OnInit } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';

import { combineLatest, BehaviorSubject, Subscription, Observable, merge, EMPTY, firstValueFrom } from 'rxjs';
import {
    debounceTime,
    distinctUntilChanged,
    map,
    mergeMap,
    shareReplay,
    switchMap,
    tap,
    throttleTime
} from 'rxjs/operators';

import { ValueEvent } from 'lassy-xpath';
import { ClipboardService } from 'ngx-clipboard';

import { animations } from '../../../animations';
import {
    DownloadService,
    FilterByXPath,
    FilterValue,
    FilterValues,
    Hit,
    ResultsService,
    StateService,
    ParseService,
    NotificationService,
    TreebankSelectionService,
    FinalResults
} from '../../../services/_index';
import { StepDirective } from '../step.directive';
import { NotificationKind } from './notification-kind';
import { GlobalState, StepType, getSearchVariables } from '../../../pages/multi-step-page/steps';
import { Filter } from '../../../models/filter';
import _, { isEqual } from 'lodash';

const DebounceTime = 2500;

interface HideSettings {
    [provider: string]: {
        [corpus: string]: {
            hiddenComponents: { [componentId: string]: boolean };
        }
    };
}

type HidableHit = Hit & { hidden: boolean };

@Component({
    animations,
    selector: 'grt-results',
    templateUrl: './results.component.html',
    styleUrls: ['./results.component.scss']
})
export class ResultsComponent extends StepDirective<GlobalState> implements OnInit, OnDestroy {
    public hidden: HideSettings = {};
    public hiddenCount = 0;
    public filteredResults: HidableHit[] = [];
    public stepType = StepType.Results;

    @Input()
    public xpath: string;

    public validXPath = true;
    public customXPath: string;
    @Output()
    public changeXpath = new EventEmitter<string>();

    // @Input('filterValues')
    // public set filterValues(v: FilterValues) {
    //     const values = Object.values(v);
    //     this.filterXPaths = values.filter((val): val is FilterByXPath => val.type === 'xpath');
    //     this.activeFilterCount = values.length;
    // }
    // public get filterValues(): FilterValues { return this.filterValuesSubject.value; }

    @Output()
    public changeFilterValues = new EventEmitter<FilterValues>();


    @Input()
    public retrieveContext = false;
    @Output()
    public changeRetrieveContext = new EventEmitter<boolean>();


    @Input()
    public inputSentence: string = null;

    @Output()
    public prev = new EventEmitter();

    @Output()
    public next = new EventEmitter();

    public loading = true;
    public loadingDownload = false;

    public activeFilterCount = 0;
    public filters: Filter[] = [];

    /**
     * Filters on node properties created in the analysis component
     */
    public filterXPaths: FilterByXPath[] = [];

    // Xml tree displaying (of a result)
    public treeXml?: string;
    public treeFilename?: string;
    public loadingTree = false;
    public treeSentence?: SafeHtml;

    public outgoingCounts = {};
    public changes = 0;

    private subscriptions: Subscription[];
    private variableProperties: GlobalState['variableProperties'];

    constructor(private downloadService: DownloadService,
        private clipboardService: ClipboardService,
        private notificationService: NotificationService,
        private resultsService: ResultsService,
        private parseService: ParseService,
        private treebankSelectionService: TreebankSelectionService,
        stateService: StateService<GlobalState>,
    ) {
        super(stateService);
        this.changeValid = new EventEmitter();
    }

    ngOnInit() {
        super.ngOnInit();
        // intermediate streams
        const state$ = this.state$.pipe(
            shareReplay(1), // this stream is used as input in multiple others, no need to re-run it for every subscription.
        );
        // const filterValues$ = this.filterValuesSubject.pipe( // the user-selected values
        //     debounceTime(1000),
        //     map(v => Object.values(v)),
        //     shareReplay(1),
        // );

        // const results$ = this.createResultsStream(state$, filterValues$);

        this.subscriptions = [
            state$.subscribe(state => {
                this.variableProperties = state.variableProperties;
                this.xpath = state.xpath;
            }),

            results$.subscribe(r => {
                if (typeof r === 'string') {
                    switch (r) {
                        case 'start': {
                            // info reset on selected treebanks changing (see below).
                            this.loading = true;
                            this.filteredResults = [];
                            this.notificationService.cancelAll();
                            this.hiddenCount = 0;
                            break;
                        }
                        case 'finish': {
                            this.loading = false;
                            break;
                        }
                    }
                } else {
                    switch (r.result.kind) {
                        case NotificationKind.COMPLETE: {
                            // treebank has finished loading
                            break;
                        }
                        case NotificationKind.ERROR: {
                            // treebank has errored out!
                            this.notificationService.add(`Error retrieving results for ${r.corpus.name}: \n${r.result.error.message}`);
                            break;
                        }
                        case NotificationKind.NEXT: {
                            // some new hits!
                            const [newHits, newHidden] = this.hideHits(r.result.value.hits);
                            this.filteredResults = [...this.filteredResults, ...newHits];
                            this.hiddenCount += newHidden;

                            // Update the counts
                            const corpus = r.corpus.name;
                            const provider = r.provider;
                            if (!this.outgoingCounts.hasOwnProperty(provider)) {
                                this.outgoingCounts[provider] = {};
                            }
                            this.outgoingCounts[provider][corpus] = r.result.value.counts;
                            // trigger change detection
                            this.outgoingCounts = { ...this.outgoingCounts };

                            this.changes = Math.random();

                            break;
                        }
                    }
                }
            }),
        ];
    }

    ngOnDestroy() {
        super.ngOnDestroy();

        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
    }

    /** Show a tree of the given xml file, needs to contact the server as the result might not contain the entire tree */
    async showTree(result: Hit) {
        this.treeXml = undefined;
        this.treeFilename = undefined;
        this.loadingTree = true;
        this.treeSentence = result.highlightedSentence;
        this.stateService.updateState(s => s.showTree = `${
            result.provider}__${
            result.corpus}__${
            result.component}__${
            result.database}__${
            result.nodeIds}`
        )

        try {
            const treeXml = await this.resultsService.highlightSentenceTree(
                result.provider,
                result.corpus,
                result.component,
                result.database,
                result.fileId,
                result.nodeIds,
            );
            this.treeXml = treeXml;
            this.treeFilename = result.fileId.replace(/\.xml$/i, '').replace(/[:\/_\-\\. ]+/g, '_') + '.xml';
        } catch (e) {
            this.treeSentence = undefined;
            this.treeXml = undefined;
            this.loadingTree = false;
            this.notificationService.add('Problem retrieving tree', 'error');
            console.warn(`Error retrieving tree in ${result.provider}:${result.corpus}:${result.component}:${result.fileId}: ${e.error.error}`);
        }

        this.loadingTree = false;
    }

    public deleteFilter(filterValue: FilterValue) {
        const { [filterValue.field]: _, ...updated } = this.filterValues;
        this.filterChange(updated);
    }

    public async downloadResults(includeNodeProperties: boolean) {
        const filterValues = Object.values(this.filterValuesSubject.value);
        const variables = includeNodeProperties
            ? getSearchVariables(
                this.parseService.extractVariables(this.xpath).variables,
                this.variableProperties)
            : undefined;

        this.loadingDownload = true;
        try {
            const results = await Promise.all(
                this.treebankSelection.corpora.map(corpus =>
                    this.resultsService.promiseAllResults(
                        this.xpath,
                        corpus.provider,
                        corpus.corpus.name,
                        corpus.corpus.components,
                        this.retrieveContext,
                        false,
                        filterValues,
                        variables).then(hits => ({
                            corpus: corpus,
                            hits
                        }))));

            const r = results.flatMap(corpusHits => ({
                xpath: this.xpath,
                components: corpusHits.corpus.corpus.components,
                provider: corpusHits.corpus.provider,
                corpus: corpusHits.corpus.corpus.name,
                hits: corpusHits.hits
            }));

            await this.downloadService.downloadResults(r, variables);
        } catch (error) {
            this.notificationService.add('Problem downloading results', 'error');
            console.error(error);
        }
        this.loadingDownload = false;
    }


    public downloadFilelist() {
        const fileNames = this.getFileNames();
        this.downloadService.downloadFilelist(fileNames, 'filelist');
    }

    /**
     * Returns the unique file names from the filtered results sorted on name.
     */
    private getFileNames() {
        return [...new Set(this.filteredResults
            .filter(h => !h.hidden)
            .map(f => f.fileId) // extract names
            .sort())];
    }

    public hideComponents({ provider, corpus, components }: { provider: string, corpus: string, components: string[] }) {
        if (!this.hidden) {
            this.hidden = {};
        }
        if (!this.hidden[provider]) {
            this.hidden[provider] = {};
        }
        const corpusInfo = this.hidden[provider][corpus];
        if (corpusInfo) {
            Object.keys(corpusInfo.hiddenComponents).forEach(comp => {
                corpusInfo.hiddenComponents[comp] = false;
            });
            components.forEach(comp => corpusInfo.hiddenComponents[comp] = true);
        } else {
            this.hidden[provider][corpus] = {
                hiddenComponents: components.reduce((dict, component) => {
                    dict[component] = true;
                    return dict;
                }, {} as HiddenComponents)
            };
        }

        [this.filteredResults, this.hiddenCount] = this.hideHits();
    }

    public filterChange(filterValues: FilterValues) {
        this.changeFilterValues.next(filterValues);
    }

    public addFiltersXPath() {
        firstValueFrom(this.state$.pipe(map(s => s.filterValues)))
        .then(filterValues => this.customXPath = this.resultsService.createFilteredQuery(
            this.xpath || this.customXPath,
            Object.values(filterValues)
        ))
        .then(newXpath => {
            this.filterChange({});
            this.changeXpath.next(newXpath);
        })
    }

    public changeCustomXpath(valueEvent: ValueEvent) {
        this.validXPath = !valueEvent.error;
        if (this.validXPath) {
            this.customXPath = valueEvent.xpath;
        }
    }

    toggleContext() {
        this.changeRetrieveContext.emit(!this.retrieveContext);
    }

    // ----

    /**
     * Gets up-to-date results for all selected treebanks
     */
    protected createResultsStream(): Observable<FinalResults> {
        return combineLatest([
            this.stateService.state$.pipe(mergeMap(async state => ({
                retrieveContext: state.retrieveContext,
                xpath: state.xpath,
                filters: state.filterValues,
            }))),
            this.treebankSelectionService.selectedTreebanksLoaded$,
        ])
        .pipe(
            distinctUntilChanged((a,b) => isEqual(a,b)),
            tap(() => this.loading = true),
            throttleTime(DebounceTime, undefined, { leading: true, trailing: true }),
            switchMap(([{retrieveContext, xpath, filters: filterValues}, selection]) => 
                this.resultsService.streamAllResultsIncrementally({
                    corpora: selection,
                    xpath,
                    metadataFilters: Object.values(filterValues),
                    retrieveContext,
                }).pipe(tap({complete: () => this.loading = false}))
            ),
        );
    }


    private hideHits2(hits: FinalResults): FinalResults&{hiddenCount: number} {
        let hiddenCount = 0;
        hits.results.forEach(r => {
            const hidden = this.hidden[r.treebank.provider]?.[r.treebank.id]?.hiddenComponents[ r.component];
            if (hidden) hiddenCount++;
            r.hidden = hidden;
        })
        return {...hits, hiddenCount: hiddenCount};
    }

    // /**
    //  * Mark the hits which are part of hidden components or banks and
    //  * return a count of the hidden hits.
    //  */
    // private hideHits(hits: Hit[] = this.filteredResults): [HidableHit[], number] {
    //     let count = 0;
    //     const marked = hits.map(result => {
    //         const hiddenCorpora = this.hidden && this.hidden[result.provider];
    //         const component = hiddenCorpora && hiddenCorpora[result.corpus.name];
    //         const hidden = component && component.hiddenComponents &&
    //             component.hiddenComponents[result.component];
    //         if (hidden) {
    //             count++;
    //         }
    //         return Object.assign({}, result, { hidden });
    //     });

    //     return [marked, count];
    // }

    public getWarningMessage() {
        // Should never show warning
    }
}
