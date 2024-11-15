
import { map } from "rxjs";
import ServiceWithStream from "./base.service";
import { Component, ComponentSet, Treebank, TreebankFull, TreebankStub } from "./treebanks.loader";
import TreebankService from "./treebanks.service";

type TreebankSelectionState = {
	id: string;
	provider: string;
	selected: boolean;
	components: Record<string, boolean>;
}

type TreebankSelectionServiceState = {
	[provider: string]: {
		[treebank: string]: TreebankSelectionState
	};
}


export default class TreebankSelectionService extends ServiceWithStream<TreebankSelectionServiceState> {
	constructor(private treebanks: TreebankService) {
		super({});
	}

	private getOrCreateState(tb: TreebankFull): TreebankSelectionState {
		if (!this.state[tb.provider]?.[tb.id]) {
			const p = this.state[tb.provider] = this.state[tb.provider] ?? {};
			p[tb.id] = {id: tb.id, provider: tb.provider, selected: false, components: {}};
		}
		return this.state[tb.provider][tb.id];
	}

	public async selectTreebank(tb: Treebank, select?: boolean) {
		tb = await this.treebanks.loadTreebank(tb);
		const s = this.getOrCreateState(tb);
		select = select ?? !s.selected;
		s.selected = select;
		if (select) {
			// when selecting a treebank and no components selected, select all components
			const allComponents = Object.keys(tb.components);
			if (!this.anySelected(s, allComponents))
				this.selectComponents(tb, allComponents, true);
		}
		// don't deselect components when deselecting a treebank
		// it's nice to the user to keep the components selected so they don't have to reselect them.
	}

	public async selectComponents(tb: Treebank, components: string[]|ComponentSet, select?: boolean) {
		components = Array.isArray(components) ? components : this.getIds(components);
		if (!components.length) return;

		tb = await this.treebanks.loadTreebank(tb);
		const s = this.getOrCreateState(tb);
		// when toggling, select all if not currently all selected.
		select = select ?? !this.allSelected(s, components); 

		if (!select) components.forEach(c => delete s.components[c]);
		else if (tb.multiOption) components.forEach(c => s.components[c] = true);
		else s.components = {[components[0]]: true};

		s.selected = Object.keys(s.components).length > 0;
	}

	public async selectComponent(treebank: Treebank, component: Component|string, newState?: boolean) {
		const id = typeof component === 'string' ? component : component.id;
		return this.selectComponents(treebank, [id], newState);
	}

	public selectSubset(treebank: TreebankStub, variant: ComponentSet, newState?: boolean) {
		return this.selectComponents(treebank, this.getIds(variant), newState);
	}

	private allSelected(state: TreebankSelectionState, components: string[]): boolean {
		return components.every(c => state.components[c]);
	}
	private anySelected(state: TreebankSelectionState, components: string[]): boolean {
		return components.some(c => state.components[c]);
	}

	private getIds(set: ComponentSet): string[] {
		return set.components.filter(c => c && !c.disabled).map(c => c.id);
	}

	public serialize(): Record<string, Record<string, string[]>> {
		const result: Record<string, Record<string, string[]>> = {};
		for (const {provider, id, selected, components} of Object.values(this.state).flatMap(e => Object.values(e))) {
			if (!selected) continue;
			const providerResult = result[provider] = result[provider] || {};
			providerResult[id] = Object.keys(components);
		}
		return result;
	}

	public deserialize(data: Record<string, Record<string, string[]>>) {
		this.state = {};
		Object.entries(data).forEach(([provider, tbs]) => Object.entries(tbs).forEach(([id, components]) => {
			this.selectComponents({provider, id, state: 'stub', loading: false}, components, true);
		}));
	}

	public async decodeUrl(queryParams: Record<string, any>) {
		this.deserialize(queryParams as any);
	}
	public get url$() { return this.state$.pipe(map(this.serialize.bind(this))); }
}
