import { Component, Input } from '@angular/core';
import { combineLatest, map, Observable, ReplaySubject, switchMap } from 'rxjs';

import { animations } from '../../../animations';
import { TreebankSelectionService } from '../../../services/_index';
import { ComponentGroup, CorpusSelection, TreebankComponent, TreebankLoaded, TreebankVariant } from '../../../treebank';

/** Add some data to the treebank for use in the template */
type TreebankInfo = TreebankLoaded & {
    showDescription: boolean,
    showWordCount: boolean,

}

/** Add some more data to the treebank for use in the template */
type SelectionInfo = {
    selectedComponents: Record<string, boolean>,
    selectedGroups: Record<string, boolean>,
    selectedVariants: Record<string, boolean>,
    allComponentsSelected: boolean,
}

type info = TreebankInfo & SelectionInfo;

@Component({
    animations,
    selector: 'grt-sub-treebanks',
    templateUrl: './sub-treebanks.component.html',
    styleUrls: ['./sub-treebanks.component.scss']
})
export class SubTreebanksComponent {
    private treebank$ = new ReplaySubject<TreebankLoaded>(1);
    @Input() public set treebank(data: TreebankLoaded) { this.treebank$.next(data); }

    public treebankAndSelection$: Observable<info>;

    constructor(private treebankSelectionService: TreebankSelectionService) {
        this.treebankAndSelection$ = combineLatest([
            this.treebank$.pipe(map(SubTreebanksComponent.addDataForTemplate)),
            this.treebank$.pipe(switchMap(tb => this.treebankSelectionService.getSelectionForTreebank$(tb))),
        ])
        .pipe(
            map(([treebankProcessedForTemplate, selection]) => ({
                ...treebankProcessedForTemplate,
                ...SubTreebanksComponent.addSelectionDataForTemplate(treebankProcessedForTemplate, selection)
            }))
        );
    }
    
    private static addDataForTemplate(treebank: TreebankLoaded): TreebankInfo {
        return {
            ...treebank, 
            showDescription: Object.values(treebank.components).some(c => !!c.description),
            showWordCount: !treebank.wordCount.unknown || treebank.wordCount.value > 0,
        }
    }
    private static addSelectionDataForTemplate(treebank: TreebankInfo, selection: CorpusSelection): SelectionInfo {
        return {
            selectedComponents: selection.components,
            selectedGroups: treebank.componentGroups.reduce((dict, g) => {
                dict[g.id] = g.components.every(c => c && selection.components[c.id]);
                return dict;
            }, {} as Record<string, boolean>),
            selectedVariants: treebank.variants.reduce((dict, v) => {
                dict[v.id] = v.components.every(c => c && selection.components[c.id]);
                return dict;
            }, {} as Record<string, boolean>),
            allComponentsSelected: Object.values(treebank.components)
                .every(c => selection.components[c.id]),
        }
    }

    toggleAll() {
        this.treebankSelectionService.toggleComponents(this.treebank);
    }

    toggleVariant(variant?: TreebankVariant) {
        if (variant) {
            this.treebankSelectionService.toggleVariant(this.treebank, variant);
        } else {
            this.treebankSelectionService.toggleComponents(this.treebank);
        }
    }

    toggleComponent(component: TreebankComponent) {
        this.treebankSelectionService.toggleComponent(this.treebank,component);
    }

    toggleGroup(group: ComponentGroup) {
        this.treebankSelectionService.toggleComponentGroup(this.treebank,group);   
    }
}
