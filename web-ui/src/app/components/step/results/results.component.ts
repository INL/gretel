import { Component, Input, OnChanges, OnDestroy, SimpleChange } from '@angular/core';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Subscription } from 'rxjs/Subscription';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/combineLatest';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/operator/distinctUntilChanged';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/switchMap';

import { ClipboardService } from 'ngx-clipboard';

import {
    ConfigurationService,
    DownloadService,
    FilterValue,
    Hit,
    MetadataValueCounts,
    ResultsService,
    TreebankService
} from '../../../services/_index';
import { TableColumn } from '../../tables/selectable-table/TableColumn';
import { Filter } from '../../filters/filters.component';
import { TreebankMetadata } from '../../../treebank';

const debounceTime = 200;

@Component({
    selector: 'grt-results',
    templateUrl: './results.component.html',
    styleUrls: ['./results.component.scss']
})
export class ResultsComponent implements OnDestroy {
    private corpusSubject = new BehaviorSubject<string>(undefined);
    private componentsSubject = new BehaviorSubject<string[]>([]);
    private xpathSubject = new BehaviorSubject<string>(undefined);
    private metadataValueCountsSubject = new BehaviorSubject<MetadataValueCounts>({});
    private metadataSubject = new BehaviorSubject<TreebankMetadata[]>([]);
    private filterValuesSubject = new BehaviorSubject<FilterValue[]>([]);

    /**
     * The components unchecked by the user, the sub-results of these components should be filtered out
     */
    public hiddenComponents: { [component: string]: true } = {};

    @Input('corpus')
    public set corpus(value: string) {
        this.corpusSubject.next(value);
    }
    public get corpus() {
        return this.corpusSubject.value;
    }

    @Input('components')
    public set components(value: string[]) {
        this.componentsSubject.next(value);
    }
    public get components() {
        return this.componentsSubject.value;
    }

    @Input('xpath')
    public set xpath(value: string) {
        this.xpathSubject.next(value);
    }
    public get xpath() {
        return this.xpathSubject.value;
    }

    public loading: boolean = true;

    public treeXml?: string;
    public filteredResults: Hit[] = [];
    public xpathCopied = false;

    public filters: Filter[] = [];

    public columns = [
        { field: 'number', header: '#', width: '5%' },
        { field: 'fileId', header: 'ID', width: '20%' },
        { field: 'component', header: 'Component', width: '20%' },
        { field: 'highlightedSentence', header: 'Sentence', width: 'fill' },
    ];

    private results: Hit[] = [];
    private subscriptions: Subscription[];

    constructor(private configurationService: ConfigurationService,
        private downloadService: DownloadService,
        private clipboardService: ClipboardService,
        private resultsService: ResultsService,
        private treebankService: TreebankService) {
        this.subscriptions = [
            // get the counts for the metadata
            // TODO: handle when filters have been applied (part of #36)
            Observable.combineLatest(this.corpusSubject, this.componentsSubject, this.xpathSubject)
                .filter((values) => values.every(value => value !== undefined))
                .debounceTime(debounceTime)
                .distinctUntilChanged()
                .switchMap(([corpus, components, xpath]) =>
                    this.resultsService.metadataCounts(this.xpath, this.corpus, this.components))
                .subscribe(counts => {
                    this.metadataValueCountsSubject.next(counts);
                }),
            // get the metadata for the current corpus
            this.corpusSubject.filter(corpus => corpus !== undefined)
                .distinctUntilChanged()
                .switchMap(corpus => this.treebankService.getMetadata(corpus))
                .subscribe(metadata => this.metadataSubject.next(metadata)),
            // get the filters
            Observable.combineLatest(this.metadataSubject, this.metadataValueCountsSubject)
                .subscribe(([metadata, counts]) => {
                    let filters: Filter[] = [];
                    for (let filter of metadata) {
                        if (filter.show) {
                            let options: string[] = [];
                            if (filter.field in counts) {
                                for (let key of Object.keys(counts[filter.field])) {
                                    // TODO: show the frequency (the data it right here now!)
                                    options.push(key);
                                }
                            }
                            filters.push({
                                field: filter.field,
                                dataType: filter.type,
                                filterType: filter.facet,
                                minValue: filter.minValue,
                                maxValue: filter.maxValue,
                                options
                            });
                        }
                    }

                    this.filters = filters;
                }),
            // get the results
            Observable.combineLatest(this.corpusSubject, this.componentsSubject, this.xpathSubject, this.filterValuesSubject)
                .filter((values) => values.every(value => value !== undefined))
                .debounceTime(debounceTime)
                .distinctUntilChanged()
                .switchMap(([corpus, components, xpath, filterValues]) => {
                    this.loading = true;
                    this.results = [];
                    this.filteredResults = [];
                    return this.resultsService.getAllResults(
                        xpath,
                        corpus,
                        components,
                        false,
                        false,
                        filterValues,
                        [],
                        () => { this.loading = false; })
                })
                .do(hit => this.results.push(hit)) // TODO: filter right here
                .debounceTime(debounceTime)
                .subscribe((hit) => {
                    this.hideComponents();
                })
        ];
    }

    ngOnDestroy() {
        for (let subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
    }

    /**
     * Show a tree of the given xml file
     * @param link to xml file
     */
    async showTree(result: Hit) {
        this.treeXml = undefined;
        this.treeXml = await this.resultsService.highlightSentenceTree(result.fileId, this.corpus, result.nodeIds);
    }

    public downloadResults() {
        this.downloadService.downloadResults(this.corpus, this.components, this.xpath, this.results);
    }

    public downloadXPath() {
        this.downloadService.downloadXPath(this.xpath);
    }

    public copyXPath() {
        if (this.clipboardService.copyFromContent(this.xpath)) {
            this.xpathCopied = true;
            setTimeout(() => {
                this.xpathCopied = false;
            }, 5000);
        }
    }

    public hideComponents(components: string[] | undefined = undefined) {
        if (components !== undefined) {
            this.hiddenComponents = Object.assign({}, ...components.map(name => { return { [name]: true } }));
        }

        this.filteredResults = this.results.filter(result => !this.hiddenComponents[result.databaseId]);
    }

    public filterChange(filterValues: FilterValue[]) {
        this.filterValuesSubject.next(filterValues);
    }

    public print() {
        (window as any).print();
    }
}
type TypedChanges = {
    [propName in keyof ResultsComponent]: SimpleChange;
}
