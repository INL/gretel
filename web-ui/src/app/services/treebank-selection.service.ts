import { Injectable } from '@angular/core';
import { StateService } from './state.service';
import { GlobalState, StepType } from '../pages/multi-step-page/steps';
import { Treebank, CorpusSelection, TreebankSelection, TreebankLoaded, TreebankStub, TreebankVariant, TreebankComponent, ComponentGroup } from '../treebank';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TreebankService } from './treebank.service';

/** 
 * Doesn't hold any state directly. 
 * Instead proxies the global state of the StateService and provides methods to update the state.
 */
@Injectable({
    providedIn: 'root'
})
export class TreebankSelectionService {
    get state$(): Observable<TreebankSelection> {
        return this.stateService.state$.pipe(map(state => state.selectedTreebanks));
    }

    getSelectionForTreebank$(treebank: Treebank): Observable<CorpusSelection> {
        return this.stateService.state$.pipe(
            map(state => state.selectedTreebanks.getTreebank(treebank))
        )
    }

    constructor(private stateService: StateService<GlobalState>, private treebankService: TreebankService) {
    }

    /**
     * Set the selected state for this bank, or toggle it if no new state is provided.
     *
     * @param _treebank
     * @param selected
     */
    async toggleCorpus(_treebank: Treebank, selected?: boolean) {
        // select all the components if a treebank is selected for the first time
        this.toggleComponents(_treebank, selected);
    }

    /**
     * Set the selected state for this component, or toggle it if no new state is provided.
     * Other components are untouched, unless the bank does not support multiOption.
     * If no components are selected after toggling, the bank itself is also deselected.
     *
     * @param _treebank
     * @param componentId
     * @param selected
     */
    async toggleComponent(_treebank: Treebank, component: TreebankComponent, selected?: boolean) {
        this.updateTreebankState(_treebank, (state, treebank) => 
            this.updateComponents(state, treebank, selected, [component])
        );
    }

    /** 
     * Toggle all components (and the treebank itself).
     * @param _treebank
     * 
     * @param selected
     */
    async toggleComponents(_treebank: Treebank, selected?: boolean) {
        this.updateTreebankState(_treebank, (state, treebank) => 
            this.updateComponents(state, treebank, selected, Object.values(treebank.components))
        );
    }

    /**
     * Set the selected state for all components in this group, or toggle it if no new state is provided.
     * Other components are untouched, unless the bank does not support multiOption.
     * If components are selected after toggling, the bank itself is also deselected.
     *
     * @param provider
     * @param corpus
     * @param selected
     */
    async toggleComponentGroup(_treebank: Treebank, group: ComponentGroup, selected?: boolean) {
        this.updateTreebankState(_treebank, (state, treebank) => 
            this.updateComponents(state, treebank, selected, group.components)
        );
    }

    async toggleVariant(_treebank: Treebank, variant: TreebankVariant, selected?: boolean) {
        await this.updateTreebankState(_treebank, (state, treebank) => 
            this.updateComponents(state, treebank, selected, variant.components)
        );
    }

    private updateComponents(state: CorpusSelection, treebank: TreebankLoaded, selected: boolean | undefined, components: Array<TreebankComponent|undefined>, ) {
        const existingComponents = components.filter(c => c && !c.disabled).map(c => c!.id);
        // If no explicit state is given, invert selection as a whole, if currently mixed, select all
        const newState = selected ?? !existingComponents.every(c => state.components[c]);
        // Update components
        existingComponents.forEach(id => state.components[id] = newState);
        // Deselect all except the first if multiOption is not enabled for this treebank
        if (newState && !treebank.multiOption) {
            existingComponents.slice(1).forEach(id => state.components[id] = false);
        }
        // Finally update the selection of the treebank itself.
        state.selected = existingComponents.some(id => state.components[id]);
    }

    /** 
     * Make sure the treebank is loaded and the state has an entry for the treebank.
     * Then run the callback with the current state and the loaded treebank.
     * Finally update the global state after the callback has done its work.
     * 
     * @returns a promise that resolves once the state update is done, which might be in the future.
     */
    private async updateTreebankState(
        _treebank: Treebank,
        updateState: (treebankState: CorpusSelection, loadedTreebank: TreebankLoaded) => void
    ) {
        return this.treebankService
        .loadTreebank(_treebank)
        .then(treebank => new Promise<void>((resolve, _) => {
            this.stateService.updateState(globalState => {
                // Create a clone of the current state in the global object
                const newState = globalState.selectedTreebanks = globalState.selectedTreebanks.clone();
                // Mutate the specific treebank in the new state in place.
                updateState(newState.getTreebank(treebank), treebank);
                if (globalState.currentStep.type === StepType.SelectTreebanks) {
                    globalState.valid = newState.hasAnySelection();
                }
                resolve();
            });
        }))
    }

    /** 
     * Get the selections for this treebank, or return a default initial object. 
     * Initial object is not placed in the state by this function
     */
    private getStateForTreebank(state: TreebankSelection, treebank: TreebankLoaded): CorpusSelection {
        return state.data[treebank.provider]?.[treebank.id] || {components: {}, selected: false};
    }
}
