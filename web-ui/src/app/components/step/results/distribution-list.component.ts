import {
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    QueryList,
    SimpleChanges,
    ViewChild,
    ViewChildren
} from '@angular/core';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { Subscription } from 'rxjs';
import { map, switchMap, distinctUntilChanged } from 'rxjs/operators';

import { DownloadService, ResultCount, StateService, TreebankService } from '../../../services/_index';
import { Treebank, TreebankComponent, TreebankSelection, FuzzyNumber, TreebankLoaded } from '../../../treebank';
import { GlobalState } from '../../../pages/multi-step-page/steps';
import { SelectTreebankProvidersComponent } from '../select-treebanks/select-treebank-providers.component';

interface ComponentState {
    title: string;
    hidden: boolean;
    sentenceCount: string;
    loading: boolean;
    hits?: number;
    percentage?: number;
}

interface KeyValue<T> {
    key: string,
    value: T
}

@Component({
    selector: 'grt-distribution-list',
    templateUrl: './distribution-list.component.html',
    styleUrls: ['./distribution-list.component.scss']
})
export class DistributionListComponent implements OnInit, OnDestroy, OnChanges {
    faDownload = faDownload;

    @Output()
    public hidingComponents = new EventEmitter<{
        provider: string,
        corpus: string,
        components: string[]
    }>();

    public loading = false;

    public state: {
        [provider: string]: {
            [corpus: string]: {
                hidden: boolean;
                sentenceCount: string;
                hits?: number;
                error?: Error;
                loading: boolean;
                components: {
                    [componentId: string]: ComponentState;
                };
            };
        };
    } = {};

    @Input()
    public incomingCounts: {
        [provider: string]: {
            [corpus: string]: [ResultCount]
        }
    } = {};

    @Input()
    public changes = 0;

    @ViewChildren('padCell')
    public padCells: QueryList<ElementRef<HTMLTableCellElement>>;

    @ViewChild('thead', { static: true })
    public thead: ElementRef<HTMLTableSectionElement>;

    @ViewChild('tbody', { static: true })
    public tbody: ElementRef<HTMLTableSectionElement>;

    private headerPadding = 0;

    public totalHits = 0;
    public totalSentences = '?';

    private subscriptions: Subscription[] = [];

    constructor(
        private downloadService: DownloadService,
        private stateService: StateService<GlobalState>,
        private treebankService: TreebankService
    ) {
    }

    ngOnInit() {
        const components$ = this.stateService.state$.pipe(
            map(state => ({
                selectedTreebanks: state.selectedTreebanks,
                xpath: state.xpath
            })),
            distinctUntilChanged((prev, curr) =>
                prev.xpath === curr.xpath &&
                prev.selectedTreebanks.equals(curr.selectedTreebanks)),
            switchMap(async state => {
                const components = await this.getComponents(state.selectedTreebanks);
                return {
                    components: components.map(x => ({
                        bank: x.bank,
                        components: x.components.filter(c => !c.disabled)
                    })).filter(x => x.components.length > 0),
                    xpath: state.xpath
                };
            }));

        this.subscriptions = [
            components$.subscribe((components) => {
                this.recreateState(components.components);
            }),
        ];
    }

    ngOnDestroy() {
        this.subscriptions.forEach(sub => sub?.unsubscribe());
        this.subscriptions = [];
    }

    ngOnChanges(changes: SimpleChanges) {
        // Update counts based on data coming from ResultsComponent
        let totalHits = undefined;
        // updateCorpus will set this to true if anything is still loading
        this.loading = false;
        const providers = new Set([
            ...Object.keys(this.incomingCounts),
            ...Object.keys(this.state),
        ]);
        for (const provider of providers) {
            const corpora = new Set([
                ...Object.keys(this.incomingCounts[provider]),
                ...Object.keys(this.state[provider] ?? {})
            ]);

            for (const corpus of corpora) {
                const corpusHits = this.updateCorpus(provider, corpus);
                if (corpusHits !== undefined) {
                    totalHits = (totalHits ?? 0) + corpusHits;
                }
            }
        }

        this.totalHits = totalHits;
    }

    private updateCorpus(provider: string, corpus: string) {
        let corpusHits = undefined;
        const emptyComponents = new Set([
            ...Object.keys(
                (this.state[provider] ?? {})[corpus]?.components ?? {})
        ]);
        const components = (this.incomingCounts[provider] ?? {})[corpus] ?? [];
        let loading = false;
        for (const resultCount of components) {
            corpusHits = (corpusHits ?? 0) + resultCount.numberOfResults;
            this.updateComponent(provider, corpus, resultCount.component, {
                loading: !resultCount.completed,
                hits: resultCount.numberOfResults,
                percentage: resultCount.percentage
            });
            if (!resultCount.completed) {
                loading = true;
            }
            emptyComponents.delete(resultCount.component);
        }

        this.state[provider][corpus].hits = corpusHits;
        for (const component of emptyComponents) {
            loading = true;
            this.updateComponent(provider, corpus, component, {
                loading: true,
                hits: undefined,
                percentage: undefined
            });
        }
        this.state[provider][corpus].loading = loading;
        if (loading) {
            this.loading = true;
        }
        return corpusHits;
    }

    private updateComponent(provider: string, corpus: string, component: string, update:
        {
            loading: boolean,
            hits?: number,
            percentage?: number
        }) {
        this.state[provider][corpus].components[component].loading = update.loading;
        this.state[provider][corpus].components[component].hits = update.hits;
        this.state[provider][corpus].components[component].percentage = update.percentage;
    }

    private recreateState(entries: Array<{ bank: Treebank, components: TreebankComponent[] }>) {
        this.state = {};
        const totalSentenceCount = new FuzzyNumber();

        entries.forEach(({ bank, components }) => {
            const p = this.state[bank.provider] =
                this.state[bank.provider] ||
                {};

            const b = p[bank.id] =
                p[bank.id] || {
                    components: {},
                    error: undefined,
                    hidden: false,
                    loading: true,
                    hits: undefined,
                    sentenceCount: components
                        .reduce((count, comp) => {
                            count.add(comp.sentenceCount);
                            return count;
                        }, new FuzzyNumber())
                        .toLocaleString()
                };

            components.forEach(c => {
                b.components[c.id] = {
                    hidden: false,
                    hits: undefined,
                    loading: true,
                    sentenceCount: c.sentenceCount.toLocaleString(),
                    title: c.title
                };

                totalSentenceCount.add(c.sentenceCount);
            });
        });

        this.totalSentences = totalSentenceCount.toLocaleString();

        this.determineHeaderPadding();
    }


    /** Return a more easily usable set of all selected treebanks/components */
    private async getComponents(selection: TreebankSelection): Promise<{
        bank: TreebankLoaded,
        components: TreebankComponent[]
    }[]> {
        const promises = selection.selectedTreebanks.map(async ({treebank, selectedComponents}) => {
            const loadedTreebank = await this.treebankService.getLoadedTreebank(treebank.provider, treebank.id);
            return {
                bank: loadedTreebank,
                components: selectedComponents.map(c => loadedTreebank.components[c])
            }
        })
        return Promise.all(promises);
    }

    public toggleComponent(provider: string, corpus: string, componentId: string, hidden: boolean) {
        const c = this.state[provider][corpus];
        c.components[componentId].hidden = hidden;
        c.hidden = Object.values(c.components).every(comp => comp.hidden);

        this.emitHiddenComponents();

        this.determineHeaderPadding();
    }

    public toggleAllComponents(provider: string, corpus: string, hidden: boolean) {
        const c = this.state[provider][corpus];
        Object.values(c.components).forEach(comp => comp.hidden = hidden);
        c.hidden = hidden;

        this.emitHiddenComponents();

        this.determineHeaderPadding();
    }

    public trackByKey<T>(index: number, keyValue: KeyValue<T>) {
        return keyValue.key;
    }

    public download() {
        function makeCounts(provider: string, corpus: string, comps: Array<ComponentState>) {
            return comps.map(c => ({
                provider,
                corpus,
                component: c.title,
                hits: c.hits,
                sentences: c.sentenceCount
            }));
        }

        const counts =
            Object.entries(this.state).flatMap(([provider, banks]) =>
                Object.entries(banks).flatMap(([corpus, info]) =>
                    makeCounts(
                        provider,
                        corpus,
                        Object.values(info.components)
                    )
                )
            );

        this.downloadService.downloadDistributionList(counts);
    }

    /**
     * Align the header text with the scrollable content.
     * This is needed because the scrollbar makes the tbody smaller
     * but the size of the thead is unaffected.
     */
    private determineHeaderPadding() {
        // run after a small timeout
        // this way changes in the layout can be taken into account
        setTimeout(() => {
            const rowWidth = (<HTMLTableRowElement>this.tbody?.nativeElement.children[0])?.offsetWidth;
            const headWidth = this.thead?.nativeElement.offsetWidth;
            const difference = headWidth - rowWidth;
            if (difference === this.headerPadding) {
                return;
            }

            this.headerPadding = difference;

            this.padCells?.forEach((header) => {
                const th = header.nativeElement;
                if (!th.dataset.originalPadding) {
                    th.dataset.originalPadding = window.getComputedStyle(th).paddingRight;
                }

                const originalPadding = th.dataset.originalPadding;

                if (difference === 0) {
                    th.style.paddingRight = originalPadding;
                } else {
                    th.style.paddingRight = `calc(${originalPadding} + ${difference}px)`;
                }
            });
        }, 10);
    }

    private emitHiddenComponents() {
        Object.entries(this.state)
            .forEach(([provider, banks]) => {
                Object.entries(banks)
                    .forEach(([name, bank]) => {
                        this.hidingComponents.emit({
                            provider,
                            corpus: name,
                            components: bank.hidden ? Object.keys(bank.components) :
                                Object.entries(bank.components)
                                    .filter(([, comp]) => comp.hidden)
                                    .map(([id]) => id)
                        });
                    });
            });
    }
}

