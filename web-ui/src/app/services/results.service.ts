import * as $ from 'jquery';
import { Injectable, SecurityContext } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { EMPTY, from, Observable } from 'rxjs';

import { ConfigurationService } from './configuration.service';
import { ParseService } from './parse.service';
import { catchError, expand, filter, mergeMap, scan, shareReplay, tap } from 'rxjs/operators';
import { PathVariable, Location } from 'lassy-xpath';
import { NotificationService } from './notification.service';
import { TreebankComponent, TreebankLoaded } from '../treebank';

const httpOptions = {
    headers: new HttpHeaders({
        'Content-Type': 'application/json',
    })
};

export interface VariableProperty {
    name: string;
    expression: string;
    enabled: boolean;
}

export interface SearchVariable {
    name: string;
    path: string;
    props?: VariableProperty[];
}

export interface SearchBehaviour {
    /** if a superset xpath is specified, then the regular xpath query will be run on the results of
        the superset query instead of directly */
    supersetXpath: string,
    expandIndex: boolean,

    /** a list of xpath queries whose results should be excluded from the results of the main query */
    exclusions?: string[],
}

type SearchParamsInput = {
    xpath: string,
    corpora: Array<{ treebank: TreebankLoaded, selectedComponents: TreebankComponent[] }>,
    retrieveContext: boolean,
    isAnalysis?: boolean,
    metadataFilters?: FilterValue[],
    variables?: SearchVariable[],
    behaviour?: SearchBehaviour,
}

type EverythingForASearch = {
    url: string;
    results?: SearchResults,
    start_from?: number,

    xpath: string,
    retrieveContext: boolean,
    /** 
     * We need to know details about the searched corpus in order to display results. 
     * Which is why we have the entire treebank object here.
    */
    treebank: TreebankLoaded,
    /** 
     * This should only contain the components that are actually selected for searching.
     * We need to know details about the searched components in order to compute statistics and for displaying a in the UI. 
     * We don't want to do this repeatedly in the components, so we pass them here. 
     */
    selectedComponents: TreebankComponent[],
    is_analysis: boolean,
    variables: Array<{
        name: string;
        path: string;
        props: Record<string, string>;
    }>
    behaviour: SearchBehaviour,
}

export type FinalResults = {
    providers: {
        [provider: string]: {
            results: Hit[],
            corpora: {
                [corpus: string]: {
                    progress: number,
                    results: Hit[],
                    components: {
                        [component: string]: Hit[],
                    }
                    variants: {
                        [variant: string]: Hit[],
                    },
                    groups: {
                        [group: string]: Hit[],
                    },
                }   
            }
        },
    }
    results: Hit[],
    progress: number,
}


@Injectable()
export class ResultsService {
    constructor(
        private http: HttpClient,
        private sanitizer: DomSanitizer,
        private configurationService: ConfigurationService,
        private parseService: ParseService,
        private notificationService: NotificationService) {
    }

    private providerSearchUrl(provider: string, corpus: string): Promise<string> {
        return this.configurationService.getDjangoUrl('search/search/');
    }


    /** 
     * Run the current search and return the input + results. 
     * If no results, an empty stream is returned. 
     * If an error occurs, the error is caught, a notification is popped and an empty stream is returned.
     * The returned object contains the results plus all information needed to request the next page of results.
     */
    nextPage(p: EverythingForASearch): Observable<EverythingForASearch> {
        if (!p.results) return EMPTY;

        return this.http.post<ApiSearchResult | false>(p.url, {
            xpath: p.xpath,
            query_id: p.results?.queryId,
            start_from: p.start_from ?? 0,
            retrieveContext: p.retrieveContext,
            treebank: p.treebank,
            components: p.selectedComponents,
            is_analysis: p.is_analysis,
            variables: p.variables,
            behaviour: p.behaviour,
        }, httpOptions)
        .pipe(
            catchError((e: HttpErrorResponse) => {
                this.notificationService.add('Error while searching: ' + e.message, 'error');
                return EMPTY;
            }),
            tap(r => {
                if (typeof r === 'boolean') return;
                if (r.cancelled) {
                    this.notificationService.add('Search was cancelled', 'warning');    
                } else if (r.search_percentage === 100 && r.errors) {
                    // TODO work on error notifications
                    this.notificationService.add('Errors occured while searching (check JavaScript console).');
                    console.log(r.errors);
                } else {
                    this.notificationService.add(`Searching at ${Math.round(r.search_percentage * 100)}%`, "success");
                }
            }),
            filter(r => r !== false && !r.cancelled),
            mergeMap(async (r: ApiSearchResult) => ({
                ...p, 
                results: await this.mapResults(p, r), 
                start_from: p.start_from + r.results.length
            }))
        )
    } 

    /** Create the required info to send a request for results to the server. */
    async makeParameters(treebank: TreebankLoaded, selectedComponents: TreebankComponent[], props: SearchParamsInput): Promise<EverythingForASearch> {
        return {
            treebank,
            selectedComponents,
            url: await this.providerSearchUrl(treebank.provider, treebank.id),
            xpath: this.createFilteredQuery(props.xpath, props.metadataFilters),
            is_analysis: props.isAnalysis,
            behaviour: props.behaviour,
            retrieveContext: props.retrieveContext,
            variables: this.formatVariables(props.variables),
        };
    }

    static addResultsToAccumulator(acc: FinalResults, r: EverythingForASearch): FinalResults {
        if (!r.results) return acc;
        
        const p = acc.providers[r.treebank.provider] = acc.providers[r.treebank.provider] || {results: [], corpora: {}};
        p.results.push(...r.results.hits);
        const t = p.corpora[r.treebank.id] = p.corpora[r.treebank.id] || {results: [], components: {}, variants: {}, groups: {}, progress: 0};
        t.results.push(...r.results.hits);

        r.results.hits.forEach(hit => {
            acc.results.push(hit);
            p.results.push(hit);
            t.results.push(hit);
            t.progress = r.results.searchPercentage;
            
            const component = r.selectedComponents.find(c => c.id === hit.component)!;
            (t.components[hit.component] = t.components[hit.component] || []).push(hit);
            if (component?.variant) (t.variants[component.variant] = t.variants[component.variant] || []).push(hit);
            if (component?.group) (t.groups[component.group] = t.groups[component.group] || []).push(hit);
        })
        return acc;
    }

    /** Return a stream that repeatedly emits an object containing all results so far. */
    streamAllResultsIncrementally(props: SearchParamsInput): Observable<FinalResults> {
        if (!props.xpath || !props.corpora?.length)
            return EMPTY;
        
        return from(props.corpora).pipe(
            mergeMap(c => this.makeParameters(c.treebank, c.selectedComponents, props)),
            expand((p, i) => this.nextPage(p)),
            scan<EverythingForASearch, FinalResults>(ResultsService.addResultsToAccumulator, {progress: 0, results: [], providers: {}}),
            shareReplay(1)
        );
    }

    /**
     * Retrieves the full sentence tree and adds a "highlight=yes" attribute to all nodes with ID, and their descendants.
     *
     * On error the returned promise rejects with @type {HttpErrorResponse}
     */
    async highlightSentenceTree(
        provider: string,
        treebank: string,
        component: string,
        database: string,
        sentenceId: string,
        nodeIds: number[],
    ) {
        /* provider, treebank and component are not used anymore,
        but leave them for now */
        const url2 = await this.configurationService.getDjangoUrl(
            'search/tree/'
        );
        const data = {
            database: database,
            sentence_id: sentenceId
        }
        const response = await this.http.post<ApiTreeResult>(
            url2,
            data
        ).toPromise();
        return this.highlightSentenceNodes(response.tree, nodeIds);
    }

    /** adds a "highlight=yes" attribute to all nodes with ID, and their descendants. */
    public highlightSentenceNodes(treeXml: string, nodeIds: Array<string | number>): string {
        const doc = $.parseXML(treeXml);
        const highlightNodes = Array.from(doc.querySelectorAll(nodeIds.map(id => `node[id="${id}"]`).join(',')));
        const highlightDescendants = highlightNodes
            .filter(n => n.hasAttribute('index'))
            .flatMap(n => Array.from(n.querySelectorAll(`node[index="${n.getAttribute('index')}"]`)));

        for (const node of [...highlightNodes, ...highlightDescendants]) {
            node.setAttribute('highlight', 'yes');
        }

        return new XMLSerializer().serializeToString(doc);
    }

    /** On error the returned promise rejects with @type {HttpErrorResponse} */
    async metadataCounts(xpath: string, provider: string, corpus: string, components: string[], metadataFilters: FilterValue[] = []) {
        return await this.http.post<MetadataValueCounts>(
            await this.configurationService.getDjangoUrl('search/metadata-count/'), {
            xpath: this.createFilteredQuery(xpath, metadataFilters),
            treebank: corpus,
            components,
        }, httpOptions).toPromise();
    }

    /**
     * Modifies an xpath query to query on filters.
     *
     * @param xpath Query to modify
     * @return string The modified xpath
     */
    public createFilteredQuery(xpath: string, filters: FilterValue[]) {
        function escape(value: string | number) {
            return value.toString()
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;');
        }

        const modifiedXpath = (xpath || '').trimRight().split('\n').map(line => ({
            line,
            appends: [] as { position: number, text: string }[]
        }));
        const metadataFilters: string[] = [];
        for (const filter of filters) {
            switch (filter.type) {
                case 'single':
                    // Single values
                    metadataFilters.push(`\tmeta[@name="${escape(filter.field)}" and @value="${escape(filter.value)}"]`);
                    break;
                case 'range':
                    // Ranged values
                    let min: string, max: string, value: string;
                    if (filter.dataType === 'date') {
                        // gets number in the format YYYYMMDD e.g. 19870227
                        min = filter.min.replace(/-/g, '');
                        max = filter.max.replace(/-/g, '');
                        value = `number(translate(@value,'-',''))`;
                    } else {
                        min = escape(filter.min);
                        max = escape(filter.max);
                        value = '@value';
                    }

                    metadataFilters.push(`\tmeta[@name="${escape(filter.field)}" and\n\t\t${value}>=${min} and ${value}<=${max}]`);
                    break;
                case 'multiple':
                    // Single values
                    metadataFilters.push(
                        `\tmeta[@name="${escape(filter.field)}" and
\t\t(${filter.values.map((v) => `@value="${escape(v)}"`).join(' or\n\t\t ')})]`);
                    break;
                case 'xpath':
                    const line = modifiedXpath[filter.location.line - 1];
                    if (line && line.line.substring(filter.location.firstColumn, filter.location.lastColumn) === 'node') {
                        line.appends.push({ position: filter.location.lastColumn, text: filter.attributeXpath });
                    } else {
                        modifiedXpath.push({
                            line: `[${filter.contextXpath}${filter.attributeXpath}]`,
                            appends: []
                        });
                    }
                    break;
            }
        }

        return modifiedXpath.map(line => {
            let offset = 0;
            const lineChars = line.line.split('');
            for (const append of line.appends.sort(a => a.position)) {
                lineChars.splice(append.position + offset, 0, ...append.text.split(''));
                offset += append.text.length;
            }
            return lineChars.join('');
        }).join('\n') + (!metadataFilters.length ? '' : `\n[ancestor::alpino_ds/metadata[\n${metadataFilters.join(' and\n')}]]`)
            .replace(/\t/g, '    ');
    }

    /**
     * Gets filters for an extracted xpath query
     * @param nodeName The variable name of the node.
     * @param attribute The attribute of that node to filter
     * @param value The attribute value (or null for not filtering)
     * @param value The available variables
     */
    public getFilterForQuery(
        nodeName: string,
        attribute: string,
        value: string,
        nodes: { [name: string]: PathVariable }): FilterByXPath {
        const attrSelector = value
            ? `@${attribute}="${value}"`
            : `@${attribute}="" or not(@${attribute})`;
        return {
            field: `${nodeName}.${attribute}`,
            label: `${nodeName}[${attrSelector}]`,
            type: 'xpath',
            location: nodes[nodeName].location,
            contextXpath: this.resolveRootPath(nodes, nodeName),
            attributeXpath: `[${attrSelector}]`
        };
    }

    private resolveRootPath(variables: { [name: string]: PathVariable }, variable: string): string {
        const path = variables[variable].path;
        if (/^\*/.test(path)) {
            return '';
        }

        const match = path.match(/(^\$node\d*)\//);
        if (match) {
            const parentVar = match[1];
            const parentPath = this.resolveRootPath(variables, parentVar);

            return (parentPath ? `${parentPath}/` : '') + path.substring(match[0].length);
        }

        return null;
    }

    private async mapResults(info: Omit<EverythingForASearch, 'results'>, results: ApiSearchResult): Promise<SearchResults> {
        return {
            hits: await this.mapHits(info, results),
            queryId: results.query_id,
            searchPercentage: results.search_percentage,
            errors: results.errors,
            cancelled: results.cancelled,
            counts: await this.mapCounts(results),
        };
    }

    private mapHits(info: Omit<EverythingForASearch, 'results'>, results: ApiSearchResult): Promise<Hit[]> {
        let lastComponent: TreebankComponent | undefined;
        return Promise.all(results.results.map(async (result): Promise<Hit> => {
            const hitId = result.sentid;
            const sentence = result.sentence;
            const sentence2 = result.sentence2;
            const previousSentence = result.prevs;
            const nextSentence = result.nexts;
            const nodeStarts = result.begins.split('-').map(x => parseInt(x, 10));
            const metaValues = this.mapMeta(await this.parseService.parseXml(`<metadata>${result.meta}</metadata>`));
            const variableValues = this.mapVariables(await this.parseService.parseXml(result.variables));
            const component = result.component;
            const database = result.database;
            
            if (lastComponent?.id !== component) lastComponent = info.selectedComponents.find(c => c.id === component)!;
            const r: Hit = {
                treebank: info.treebank,
                component,
                database,

                fileId: hitId.replace(/\+match=\d+$/, ''),
                sentence,
                sentence2,
                previousSentence,
                nextSentence,
                highlightedSentence: this.highlightSentence(sentence, nodeStarts, 'strong'),
                highlightedSentence2: this.highlightSentence(sentence2 || '', nodeStarts, 'strong'),
                treeXml: result.xml_sentences,
                nodeIds: result.ids.split('-').map(x => parseInt(x, 10)),
                nodeStarts,
                metaValues,
                variableValues,
                hidden: false,
            };
            return r;
        }));
    }

    private mapCounts(results: ApiSearchResult): Promise<ResultCount[]> {
        return Promise.all(results.counts.map(async count => {
            return {
                component: count.component,
                numberOfResults: count.number_of_results,
                completed: count.completed,
                percentage: count.percentage,
            };
        }));
    }

    private mapMeta(data: {
        metadata: {
            meta?: {
                $: {
                    type: string,
                    name: string,
                    value: string
                }
            }[]
        }[]
    }): Hit['metaValues'] {
        return !data.metadata || !data.metadata.length || !data.metadata[0].meta ? {} : data.metadata[0].meta.reduce((values, meta) => {
            values[meta.$.name] = meta.$.value;
            return values;
        }, {} as Hit['metaValues']);
    }

    private mapVariables(data: '' | {
        vars: {
            var: {
                $: {
                    name: string,
                    pos?: string,
                    lemma?: string
                }
            }[]
        }[]
    }): Hit['variableValues'] {
        if (!data || !data.vars) {
            return {};
        }
        return data.vars[0].var.reduce((values, variable) => {
            values[variable.$.name] = variable.$;
            return values;
        }, {} as Hit['variableValues']);
    }

    /** Format variables for sending to the server */
    private formatVariables(variables: SearchVariable[]): EverythingForASearch['variables'] {
        return variables?.map(variable => ({
            name: variable.name,
            path: variable.path,
            props: this.formatVariableProps(variable.props)
        }));
    }

    /** Returns a map of propname -> prop expression */
    private formatVariableProps(props?: SearchVariable['props']): Record<string, string>|undefined {
        return props?.length && props.reduce((acc, prop) => {
            if (prop.enabled) acc[prop.name] = prop.expression;
            return acc;
        }, {});
    }

    private highlightSentence(sentence: string, nodeStarts: number[], tag: string) {
        // translated from treebank-search.php
        let prev: string, next: string;

        if (sentence.indexOf('<em>') >= 0) {
            // Showing the context of this hit
            const $groups = /(.*<em>)(.*?)(<\/em>.*)/.exec(sentence);
            sentence = $groups[2];
            prev = $groups[1];
            next = $groups[3];
        }

        const words = sentence.split(' ');

        // Instead of wrapping each individual word in a tag, merge sequences
        // of words in one <tag>...</tag>
        for (let i = 0; i < words.length; i++) {
            if (nodeStarts.indexOf(i) >= 0) {
                let value = '';
                if (nodeStarts.indexOf(i - 1) === -1) {
                    value += `<${tag}>`;
                }
                value += words[i];
                if (nodeStarts.indexOf(i + 1) === -1) {
                    value += `</${tag}>`;
                }
                words[i] = value;
            }
        }
        let highlightedSentence = words.join(' ');
        if (prev || next) {
            highlightedSentence = prev + ' ' + highlightedSentence + ' ' + next;
        }

        return this.sanitizer.sanitize(SecurityContext.HTML, highlightedSentence);
    }
}

/**
 * The results as returned by the API. The results consist of an array containing various parts
 * of the results. These are described for each item position below.
 * Each result has an ID which corresponds. For example results[0] contains a dictionary with
 * the plain text sentences, they same keys are used for results[4] containing the xml of
 * each hit.
 */
type ApiSearchResult = {
    results: {
        sentid: string,
        sentence: string,
        /** GCND */
        sentence2: string,
        prevs: string,
        nexts: string,
        ids: string,
        begins: string,
        xml_sentences: string,
        meta: string,
        /** Contains the XML of the node matching the variable */
        variables: string,
        component: string,
        database: string
    }[],
    query_id: number,
    search_percentage: number,
    errors: string,
    cancelled?: boolean,
    counts: {
        component: string,
        number_of_results: number,
        completed: boolean,
        percentage: number,
    }[],
};

/** Processed search results created from the response */
export interface SearchResults {
    hits: Hit[];
    queryId: number;
    searchPercentage: number;
    errors: string;
    cancelled?: boolean;
    counts: ResultCount[];
}

export interface Hit {
    treebank: TreebankLoaded,
    /** Id of the component this hit originated from */
    component: string;
    /**
     * Id of the database this hit originated from.
     * Usually identical to the component, but may differ in large treebanks - dbs and components are many-to-1.
     * Used to request the full sentence xml
     */
    database: string;
    fileId: string;
    /** The basic sentence this hit was found in, extracted from its xml. */
    sentence: string;
    /** Alternate sentence (GCND) */
    sentence2: string;
    previousSentence: string;
    nextSentence: string;
    highlightedSentence: SafeHtml;
    highlightedSentence2: SafeHtml;
    /* The XML of the matched portion of the sentence, does not always contain the full xml! */
    treeXml: string;
    /** The ids of the matching nodes */
    nodeIds: number[];
    /** The begin position of the matching nodes */
    nodeStarts: number[];
    metaValues: { [key: string]: string };
    /** Contains the properties of the node matching the variable */
    variableValues: { [variableName: string]: { [propertyKey: string]: string } };
    /** For UI purposes. Never set by server. */
    hidden: boolean;
}

export interface ResultCount {
    component: string;
    numberOfResults: number;
    completed: boolean;
    percentage: number;
}

export type FilterValue = FilterByField | FilterByXPath;
export type FilterByField =
    FilterSingleValue
    | FilterRangeValue<string, 'date'>
    | FilterRangeValue<number, 'int'>
    | FilterMultipleValues<string, 'text'>;

export interface FilterValues { [field: string]: FilterValue; }

export interface FilterSingleValue {
    type: 'single';
    dataType: 'text';
    field: string;
    value: string;
}

export interface FilterRangeValue<T, U> {
    type: 'range';
    dataType: U;
    field: string;
    min: T;
    max: T;
}

export interface FilterMultipleValues<T, U> {
    type: 'multiple';
    dataType: U;
    values: Array<T>;
    field: string;
}

export interface FilterByXPath {
    /// The variable name + attribute e.g. $node1.pt
    field: string;
    type: 'xpath';
    label: string;
    location: Location;
    /**
     * The predicate to add to the node to filter it.
     */
    attributeXpath: string;
    /**
     * Selector to add to the entire query to select the node
     * being filtered on. This is necessary if the node cannot be
     * modified in the main query. That can happen if that query has
     * been changed by the user (in the results component).
     */
    contextXpath: string;
}

export interface TreebankCount {
    componentId: string;
    count: number;
}

export interface MetadataValueCounts { [key: string]: { [value: string]: number }; }

type ApiTreeResult = {
    tree?: string,
    error?: string
}
