import { Injectable } from '@angular/core';
import { map, materialize } from 'rxjs/operators';

import { combineLatest, from, Observable, ObservableNotification, zip } from 'rxjs';
import { TreebankLoaded, TreebankSelection } from '../treebank';
import { FilterValue, HitWithOrigin, ResultsService, SearchBehaviour, SearchResults } from './results.service';
import { TreebankService } from './treebank.service';

@Injectable({ providedIn: 'root' })
export class ResultsStreamService {
    constructor(private resultsService: ResultsService, private treebankService: TreebankService) {
    }

    stream(xpath: string,
        selection: TreebankSelection,
        filterValues: FilterValue[],
        retrieveContext: boolean,
        behaviour?: SearchBehaviour
    ): Array<
        Observable<{
            result: ObservableNotification<SearchResults&{hits: HitWithOrigin[]}>, 
            provider: string, 
            corpus: string
        }>
    > {
        // create a request for each treebank
        return selection.selectedTreebanks.map(({treebank, selectedComponents}) => {
            // create the basic request, without error handling
            const base: Observable<SearchResults> = this.resultsService.getAllResults(
                xpath,
                treebank.provider,
                treebank.id,
                selectedComponents,
                retrieveContext,
                false,
                filterValues,
                [],
                behaviour,
            );

            return combineLatest([base, from(this.treebankService.getLoadedTreebank(treebank.provider, treebank.id))])
            .pipe(
                // expand hits with the corpus and provider
                // (so we can use this later in the interface)
                // This mapping is skipped if the query returns an error
                map<[SearchResults, TreebankLoaded], SearchResults&{hits: HitWithOrigin[]}>(([results, loadedTreebank]) => ({
                    ...results,
                    hits: results.hits.map<HitWithOrigin>((hit) => ({
                        ...hit,
                        provider: treebank.provider,
                        corpus: treebank,
                        componentDisplayName: loadedTreebank.components[hit.component].title,
                    })),
                })),
                
                // (This will run even if base receives an error)
                // Capture errors and send them on as a regular events
                // This is required because this only one stream in a set of multiple result streams
                // that will eventually be merged together
                // and we don't want that merged stream to abort when one of them throws an error
                materialize(),

                // We've already attached the provider and corpus to the results,
                // but if an error happens, or we're done requesting results,
                // that message doesn't contain that info yet, so attach it
                map(result => ({
                    result,
                    provider: treebank.provider,
                    corpus: treebank.id,
                })),
            )
        });
    }
}
