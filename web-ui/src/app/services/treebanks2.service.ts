import { HttpClient } from "@angular/common/http";
import { FuzzyNumber, TreebankComponent } from "../treebank";
import _, { countBy, create, isMap } from "lodash";
import { ConfigurationService } from "./configuration.service";
import { BehaviorSubject, filter, first, firstValueFrom, ignoreElements, map, Observable, of, skip, skipUntil, Subject, switchMap, take, takeUntil } from "rxjs";
import { query } from "@angular/animations";
import { TokenAttributes } from "../models/matrix";
import { FilterValues } from "./results.service";
import { AlpinoService } from './alpino.service';

export type Component = {
	id: string;
	displayName: string;
	description: string;
	disabled: boolean;
	wordCount: FuzzyNumber;
	sentenceCount: FuzzyNumber;
	
	group?: ComponentSet;
	variant?: ComponentSet;
}
export type ComponentSet = {
	components: Array<Component|undefined>;
	id: string;
	displayName: string;
	description: string;
	sentenceCount: FuzzyNumber;
	wordCount: FuzzyNumber;
}

export type MetadataDefinition = {
	type: 'text'|'checkbox'|'slider'|'dropdown';
	values?: string[];
	min?: number;
	max?: number;
}
type WithState<T extends string> = { state: T; loading: boolean }

type TreebankStub = {
	state: 'stub';
	loading: boolean;

	provider: string;
	id: string;
}
type TreebankBase = Omit<TreebankStub, 'state'|'loading'>&{
	state: 'partial'
	loading: boolean;

	displayName: string;
	description: string;
	multiOption: boolean;

	/** user id, email, whatever. */
	owner?: string;
}
type TreebankFull = Omit<TreebankBase, 'state'|'loading'>&{
	state: 'loaded';
	loading: boolean;

	components: Record<string, Component>;
	variants: ComponentSet[];
	groups: ComponentSet[];
	// TODO
	// metadata: Record<string, MetadataDefinition>;
}

type Treebank = TreebankStub|TreebankBase|TreebankFull;

// export type Treebank = Readonly<TreebankPartial>|Readonly<TreebankFull>|Readonly<TreebankStub>;


// hoe doen we metadata discovery
// want op dit moment wordt de metadata uit de resultaten gehaald
// maar misschien willen we de metadata alvast laten zien?
// of we geven er niets om, en laden de metadata gewoon niet uit de backend
// maar creëren de filters op basis van de facetten.
// dan hebben we wel geen display names en descriptions maar is dat erg?
// hebben we nu ook niet.

type TreebankSelectionState = {
	id: string;
	provider: string;
	selected: boolean;
	components: Record<string, boolean>;
}

// so this thing should only contain the booleans
// then we can have a second service over the top that ties it together with the loading of the treebanks
// and exposes some more useful methods (getSelectedTreebanks, getLoadedTreebanks, etc)
// we can also have a method that returns the serialized state
// and a method that loads the state from the serialized state
// (which does the async thing.)

// every time we have to expose a stream that the parent state service can subscribe to
// (in order to update its own global state object)

// we just want id-value pairs here, I think.
// if we have just the strings in this service
// then we need to marry them to the treebanks in the overlying service
// but whatever works and lets us load the selection state.

// Can't select a treebank without loading it first.
// Because we need the components and the multiOption setting.
type TreebankSelectionServiceState = {
	[provider: string]: {
		[treebank: string]: TreebankSelectionState
	};
}

abstract class ServiceWithStream<T> {
	protected _state: BehaviorSubject<Readonly<T>>;
	public get state$(): Observable<Readonly<T>> {
		return this._state.asObservable();
	}
	protected set state(value: T) { this._state.next(value); }
	protected get state(): T {
		const self = this;

		function createProxy(
			parent: any,
			parentProp?: string | symbol,
			actualObjectInProp?: any
		) {
			function isMutableObject(o: any): o is object { 
				return o?.constructor === Object || Array.isArray(o) || o instanceof Set || o instanceof Map || o instanceof Date;
			}
			function makeCopy(o: any) {
				if (o?.constructor === Object) return { ...o };
				if (Array.isArray(o)) return [...o];
				if (o instanceof Set) return new Set(o);
				if (o instanceof Map) return new Map(o);
				if (o instanceof Date) return new Date(o);
			}

			const isRoot = !parentProp;
			return new Proxy(actualObjectInProp || parent, {
				set: (target, property, value, receiver) => {
					if (isRoot) {
						self._state.next({ ...parent, [property]: value });
					} else {
						const copy = makeCopy(actualObjectInProp);
						copy[property] = value;
						// In case we're re-using the same object, also update the actual value.
						target[property] = value;
						// this will update the parent observable (which bubbles and calls next on the observable)
						parent[parentProp] = copy;
					}
					return true;
				},
				get: (target, property, receiver) => {
					const actualObjectInTarget = isRoot
						? parent[property]
						: actualObjectInProp[property];
					if (isMutableObject(actualObjectInTarget)) {
						return createProxy(receiver, property, actualObjectInTarget);
					} else {
						return actualObjectInTarget;
					}
				},
			});
		}

		return createProxy(this._state.value);
	}

	constructor(initialState: T) {
		this._state = new BehaviorSubject(initialState);
	}
}

class TreebankSelectionService extends ServiceWithStream<TreebankSelectionServiceState> {
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
}

namespace Django {
	export type TreebankResponse = Array<{
		slug: string;
		title: string;
		description: string;
		url_more_info: string;
	}>

	export type ComponentResponse = Array<{
		description: string;
		group: string;
		nr_sentences: number;
		nr_words: number;
		slug: string;
		title: string;
		variant: string;
	}>
}

namespace Legacy {
	export type TreebanksResponse = {
		[treebank: string]: {
			components: Record<string, {
				id: string,
				title: string,
				description: string,
				sentences: number | '?',
				words: number | '?',
				group?: string,
				variant?: string,
				disabled?: boolean
			}>,
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
}

namespace LegacyUpload {
	export type TreebankResponse = Array<{
		email: string;
		id: string;
		processed: string;
		public: '1' | '0';
		title: string;
		uploaded: string;
		user_id: string;
	}>

	export type ComponentResponse = Array<{
		basex_db: string;
		nr_sentences: string;
		nr_words: string;
		slug: string;
		title: string;
	}>
}

function ComponentHelper<T>(p: {
	components: T[],
	createComponent: (c: T) => Component,
	getVariant: (c: T) => string|undefined,
	getGroup: (c: T) => string|undefined,
	setVariantInfo?(v: ComponentSet): ComponentSet,
	setGroupInfo?(g: ComponentSet): ComponentSet,
}): Pick<TreebankFull, 'components'|'variants'|'groups'> { 
	function create(id: string, cb?: ((v: ComponentSet)=> ComponentSet)): ComponentSet {
		const v: ComponentSet = {
			id,
			displayName: id,
			description: '',
			components: [],
			sentenceCount: new FuzzyNumber(0),
			wordCount: new FuzzyNumber(0),
		};
		return cb ? cb(v) : v;
	}

	const vi = new Map<string, number>();
	const gi = new Map<string, number>();
	const variants: ComponentSet[] = [];
	const groups: ComponentSet[] = [];
	const components: Record<string, Component> = {};	
	
	for (const c of p.components) {
		const component = p.createComponent(c);
		components[component.id] = component;

		const g = p.getGroup(c);
		const v = p.getVariant(c);
		if (!g || !v) {
			component.group = undefined;
			component.variant = undefined;
			continue;
		}
		
		const groupIndex = gi.set(g, gi.get(g) ?? gi.size).get(g);
		const variantIndex = vi.set(v, vi.get(v) ?? vi.size).get(v);
		const group = groups[groupIndex] = groups[groupIndex] ?? create(g, p.setGroupInfo);
		const variant = variants[variantIndex] = variants[variantIndex] ?? create(v, p.setVariantInfo);
	
		group.components[variantIndex] = component;
		variant.components[groupIndex] = component;
		group.sentenceCount.add(component.sentenceCount);
		group.wordCount.add(component.wordCount);	
		component.group = group;
		component.variant = variant;
	}

	return {components, variants, groups};
}

abstract class TreebankLoader {
	constructor(protected http: HttpClient, public provider: string, protected baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}

	abstract loadPreviews(): Promise<Treebank[]>;
	abstract loadTreebank(treebank: Treebank): Promise<TreebankFull>;
	abstract loadTreebanks(treebanks: Treebank[]): Promise<TreebankFull[]>;
}

class TreebankLoaderDjango extends TreebankLoader {
	private previewUrl() { return `${this.baseUrl}/treebanks/treebank/`; }
	private componentsUrl(treebank: {id: string}) { return `${this.baseUrl}/treebanks/${treebank.id}/components/`; }
	
	async loadPreviews(): Promise<Treebank[]> {
		const response = await this.http.get<Django.TreebankResponse>(this.previewUrl()).toPromise();
		return response.map(({slug, title, description, url_more_info}) => ({
			provider: 'django', 
			id: slug, 
			description,
			displayName: title, 
			multiOption: true, 
			owner: '', 
			state: 'partial',
			loading: false
		}));
	}

	async loadTreebank(treebank: Treebank): Promise<TreebankFull> {
		if (treebank.state === 'loaded') return treebank;
		// HACK: solve this case.
		// we can get a partial here if the treebank was selected before loading (i.e. from the url on navigation).
		if (treebank.state === 'stub') {
			treebank = (await this.loadPreviews()).find(tb => tb.id === treebank.id) as TreebankBase;
		}
		
		const response = this.http.get<Django.ComponentResponse>(this.componentsUrl(treebank)).toPromise();
		return response.then<TreebankFull>(r => ({
			...treebank,
			...ComponentHelper({
				components: r,
				createComponent: c => ({
					description: c.description,
					disabled: false,
					displayName: c.title,
					id: c.slug,
					sentenceCount: new FuzzyNumber(c.nr_sentences),
					wordCount: new FuzzyNumber(c.nr_words),
				}),
				getGroup: c => c.group,
				getVariant: c => c.variant,
			}),
			state: 'loaded',
		}));
	}
	
	async loadTreebanks(treebanks: Treebank[]): Promise<TreebankFull[]> {
		return Promise.all(treebanks.map(p => this.loadTreebank(p)));
	}
}

class TreebankLoaderLegacy extends TreebankLoader {
	private treebanksUrl(): string { return this.baseUrl + '/configured_treebanks' }

	async loadPreviews(): Promise<Treebank[]> {
		const response = await this.http.get<Legacy.TreebanksResponse>(this.treebanksUrl()).toPromise();
		return Object.entries(response).map(([id, treebank]) => ({
			provider: this.provider, 
			id, 
			description: treebank.description,
			displayName: treebank.title, 
			multiOption: treebank.multioption ?? false, 
			...ComponentHelper({
				components: Object.values(treebank.components),
				createComponent: c => ({
					description: c.description,
					disabled: false,
					displayName: c.title,
					id: c.id,
					sentenceCount: new FuzzyNumber(c.sentences),
					wordCount: new FuzzyNumber(c.words),
				}),
				getGroup: c => c.group,
				getVariant: c => c.variant,
				setGroupInfo: g => { g.description = treebank.groups?.[g.id]?.description ?? ''; return g; },
				setVariantInfo: v => { v.displayName = treebank.variants?.[v.id]?.display ?? ''; return v; },
			}),
			state: 'loaded',
			loading: false,
		}));
	}

	async loadTreebank(treebank: Treebank): Promise<TreebankFull> {
		if (treebank.state !== 'loaded') throw new Error('Treebank not loaded - should never happen in legacy loader');
		return treebank as TreebankFull;
	}
	async loadTreebanks(treebanks: Treebank[]): Promise<TreebankFull[]> {
		return Promise.all(treebanks.map(tb => this.loadTreebank(tb)));
	}
}

class TreebankLoaderLegacyUpload extends TreebankLoader {
	private previewUrl(): string { return this.baseUrl + '/index.php/api/treebank/'; }
	private componentsUrl(treebank: {id: string}) { return `${this.baseUrl}/treebank/show/${encodeURIComponent(treebank.id)}/`; }
	private metadataUrl(treebank: {id: string}) { return `${this.baseUrl}/treebank/metadata/${encodeURIComponent(treebank.id)}/`; }

	async loadPreviews(): Promise<Treebank[]> {
		return this.http.get<LegacyUpload.TreebankResponse>(this.previewUrl()).toPromise()
		.then<TreebankBase[]>(uploads => 
			uploads.map(u => ({
				provider: 'upload',
				id: u.id,
				description: '',
				displayName: u.title,
				multiOption: true,
				owner: u.email,
				state: 'partial',
				loading: false,
			})
		));
	}
	async loadTreebank(treebank: Treebank): Promise<TreebankFull> {
		if (treebank.state === 'loaded') return treebank;
		if (treebank.state === 'stub') {
			treebank = (await this.loadPreviews()).find(tb => tb.id === treebank.id) as TreebankBase;
		}

		return this.http.get<LegacyUpload.ComponentResponse>(this.componentsUrl(treebank)).toPromise()
		.then<TreebankFull>(r => ({
			...treebank,
			...ComponentHelper({
				components: r,
				createComponent: c => ({
					description: '',
					disabled: false,
					displayName: c.title,
					id: c.slug,
					sentenceCount: new FuzzyNumber(c.nr_sentences),
					wordCount: new FuzzyNumber(c.nr_words),
				}),
				getGroup: c => undefined,
				getVariant: c => c.basex_db,
			}),
			state: 'loaded',
		}));
	}
	async loadTreebanks(treebanks: Treebank[]): Promise<TreebankFull[]> {
		return Promise.all(treebanks.map(tb => this.loadTreebank(tb)));
	}
}

class TreebankService extends ServiceWithStream<Treebank[]> {
	private loaders: TreebankLoader[] = [];
	private loadingFinished$ = new Subject<TreebankFull>();
	
	public loading$ = new BehaviorSubject<boolean>(false);
	
	constructor(
		private http: HttpClient,
		private configurationService: ConfigurationService,
	) {
		super([]);
		
		this.loading$.next(true);
		Promise.all([
			configurationService.getRootUrl(), 
			configurationService.getLegacyUploadUrl(),
			configurationService.getLegacyProviders()
		])
		.then(([djangoUrl, legacyUploadUrl, legacyProviders]) => {
			this.loaders.push(new TreebankLoaderDjango(http, 'django', djangoUrl));
			if (legacyUploadUrl) this.loaders.push(new TreebankLoaderLegacyUpload(http, 'legacy_upload', legacyUploadUrl));
			Object.entries(legacyProviders).forEach(([provider_id, url]) => {
				this.loaders.push(new TreebankLoaderLegacy(http, provider_id, url));
			});
		})
		.then(() => this.loadPreviews())
		.then(() => this.loading$.next(false));
	}

	/** Replace the treebank in our state array. Should automatically emit on the stream. */
	private update(tb: Treebank) { 
		// Bypass proxy
		let i = this._state.value.findIndex(t => t.provider === tb.provider && t.id === tb.id);
		if (i === -1) this.state.push(tb);
		else this.state[i] = tb;
	}

	private untilLoaded$(tb: Treebank): Observable<TreebankFull> {
		if (tb.state === 'loaded') 
			return of(tb as TreebankFull);
		else
			return this.loadingFinished$.pipe(filter(tb => tb.provider === tb.provider && tb.id === tb.id), first());
	}

	private async loadPreviews() {
		return Promise.all(this.loaders.map(async loader => {
			const previews = await loader.loadPreviews();
			previews.forEach(tb => {
				const i = this.state.findIndex(t => t.provider === tb.provider && t.id === tb.id);
				if (i !== -1) this.state[i] = tb;
				else this.state.push(tb);
			});
		}))
	}

	public async loadTreebank(treebank: Treebank): Promise<TreebankFull> {
		if (treebank.loading) 
			return this.untilLoaded$(treebank).toPromise(); // should eventually return the loaded treebank
		if (treebank.state === 'loaded') 
			return treebank;
		
		const loader = this.loaders.find(l => l.provider === treebank.provider);
		if (!loader) throw new Error(`Loader not found for provider ${treebank.provider}`);
		this.update({ ...treebank, loading: true });
		const loaded = await loader.loadTreebank(treebank);
		this.update(loaded);
		return loaded;
	}
}

type RecursivePartial<T> = { [P in keyof T]?: RecursivePartial<T[P]>; }
type QueryParams = Record<string, string|object[]|Record<string, string>>;
abstract class StepThing<T> {
	async canLeave(state: T): Promise<boolean> { return true; }
	async canEnter(state: T): Promise<boolean> { return true; }

	abstract decodeState(state: T, urlState: QueryParams): Promise<TransitionResult>;
	async leave(state: T): Promise<TransitionResult> { return this.canLeave(state) ? TransitionResult.ok() : TransitionResult.error('Cannot leave current step'); }
	async enter(state: T): Promise<TransitionResult> { return this.canEnter(state) ? TransitionResult.ok() : TransitionResult.error('Cannot enter current step'); }
}

class TransitionResult {
	constructor(public ok: boolean, public error?: string) {}
	static ok(): TransitionResult {return new TransitionResult(true);}
	static error(message: string): TransitionResult {return new TransitionResult(false, message);}
}


type Primitive =
  | bigint
  | boolean
  | null
  | number
  | string
  | symbol
  | undefined;

type JSONValue = Primitive | JSONObject | JSONArray;

interface JSONObject {
  [key: string]: JSONValue;
}

interface JSONArray extends Array<JSONValue> { }

abstract class StepBasedState<State extends JSONObject|JSONArray, T extends object = QueryParams> extends ServiceWithStream<State&{
	/** Step is always the current thing on screen. It does not update until transitioning becomes false. */
	step: number, 
	transitioning: boolean
}> {
	public abstract get urlState$(): Observable<T>;
	public get canEnterNextStep$() { 
		return this.state$.pipe(switchMap(s => {
			return this.state.step < this.steps.length - 1 && this.steps[this.state.step + 1].canEnter(s); 
		}))
	}
	constructor(initialState: State, protected steps: StepThing<StepBasedState<State, T>>[], urlState: QueryParams) {
		super({...initialState, step: 0, transitioning: false})
		this.decodeState(urlState);
	}
	
	protected async advanceUntil(step: number): Promise<TransitionResult> {
		while (this.state.step < step) {
			const r = await this.advanceStep();
			if (!r.ok) return r;
		}
		return TransitionResult.ok();
	}
	protected async returnUntil(step: number): Promise<TransitionResult> {
		while (this.state.step > step) {
			const r = await this.returnStep();
			if (!r.ok) return r;
		}
		return TransitionResult.ok();
	}

	private async transition(cur: number, next: number) {
		if (Math.abs(cur - next) !== 1) return TransitionResult.error('Invalid transition');
		if (this.state.transitioning) return TransitionResult.error('Already transitioning');

		const curStep = this.steps[cur];
		const nextStep = this.steps[next];
		if (!curStep) return TransitionResult.error(`Cannot transition from non-existent step ${cur}`);
		if (!nextStep) return TransitionResult.error(`Cannot transition to non-existent step ${next}`);

		this.state.transitioning = true;
		return curStep.leave(this).then(() => nextStep.enter(this)).then(r => {
			this.state.step = next;
			this.state.transitioning = false;
			return r;
		})
	}

	async advanceStep(): Promise<TransitionResult> {
		return this.transition(this.state.step, this.state.step + 1);
	}
	async returnStep(): Promise<TransitionResult> {
		return this.transition(this.state.step, this.state.step - 1);
	}

	protected abstract decodeStateImpl(queryParams: QueryParams): Promise<TransitionResult>;
	protected abstract encodeStateImpl(state: State): QueryParams;
	private async decodeState(queryParams: QueryParams) {
		const r = await this.decodeStateImpl(queryParams);
		if (!r.ok) return r;
		
		if ('step' in queryParams) {
			const step = parseInt(queryParams.step as any);
			if (isNaN(step) || step < 0 || step >= this.steps.length) return true; // invalid step, stay on initial step.
			if (this.state.step < step) return this.advanceUntil(step);
			if (this.state.step > step) return this.returnUntil(step);
		}

		return true;
	}

	protected decodeBool(value: string|undefined) { return value === '1' ? true : value === '0' ? false : undefined; }
	protected encodeBool(value: boolean|undefined) { return value === true ? '1' : value === false ? '0' : undefined; }
}

// these should be 100% url types


type ExampleBasedState = {
	selectedTreebanks: ReturnType<(InstanceType<typeof TreebankSelectionService>)['serialize']>;

	inputSentence?: string;
	xpath?: string;

	test: string[];
	
	filterValues: FilterValues;
	
	/** Include context in results (the preceding and following sentence) */
	retrieveContext: boolean;
	/** Query additional custom properties for variables */
	variableProperties: Array<{
		// start with $, refers to an existing variable extracted from
		// the query tree
		variableName: string;
		// start with _
		propertyName: string;
		propertyExpression: string;
		enabled: boolean;
	}>;
	isCustomXPath: boolean;
		
	exampleXml: string;
	subTreeXml: string;
	
	/** ?? */
	tokens: string[];
	attributes: TokenAttributes[];
	/** Ignores properties of the dominating node */
	ignoreTopNode: boolean;
	/** Respect word order */
	respectOrder: boolean;
	
}

class StateManagerExampleBased extends StepBasedState<FilterValues> {
	private readonly attributesSeparator = ':';

	constructor(
		private http: HttpClient, 
		private configurationService: ConfigurationService, 
		private alpinoService: AlpinoService,
		private treebankService: TreebankService,
		private treebankSelectionService: TreebankSelectionService,
		queryParams: QueryParams
	) {
		super({
			selectedTreebanks: {},
			filterValues: {},
			attributes: [],
			exampleXml: '',
			ignoreTopNode: false,
			isCustomXPath: false,
			respectOrder: false,
			retrieveContext: false,
			subTreeXml: '',
			tokens: [],
			variableProperties: [],
			test
		}, [
			new ExampleBasedStep0(),
			new ExampleBasedStep1()
		], queryParams)


		// we now have an object that has the current json state
		// but some of this state is contained within nested services
		// and we also want to update the parent service when the nested service has an update
		// but how do we know when to do that in the parent service
		// we need some way to propagate that data up
		// the problem is that if we do this.state.selection.someMutation() 
		// then what will the proxy do
		// probably call the function, which works
		// BUT, the problem will be it will try to spread the object
		// and I'm not positive you can do that with classes

	}

	decodeStateImpl(queryParams: QueryParams): Promise<TransitionResult> {
		let attributes: string[];
		let isCustomXPath: boolean;
		if (Array.isArray(queryParams.attributes)) {
			// fallback for old URLs
			attributes = queryParams.attributes;
			isCustomXPath = true; // preserve the existing XPath
		} else {
			attributes = queryParams.attributes?.split(this.attributesSeparator);
			isCustomXPath = this.decodeBool(queryParams.isCustomXPath)
		}

		// ideally you have the selected treebanks here, or nothing makes any sense.
		// so we need to load the treebanks first, and then load the state (if there is a selection in the query params)
		// in the selection component, we want to 

		
		this.state.treebanks = new TreebankService(this.http, this.configurationService),
		this.state.selection = new TreebankSelection({}),
		this.state.xpath = queryParams.xpath || undefined,
		this.state.inputSentence = queryParams.inputSentence || undefined,
		this.state.isCustomXPath =
		this.state.attributes = this.alpinoService.attributesFromString(attributes),
		this.state.retrieveContext = this.decodeBool(queryParams.retrieveContext),
		this.state.respectOrder = this.decodeBool(queryParams.respectOrder),
		this.state.ignoreTopNode = this.decodeBool(queryParams.ignoreTopNode)
	
	}

	inputSentence(sentence: string) {
		this.state.inputSentence = sentence;
	}
}


// class StateManagerExampleBased extends StepBasedState<QueryParams, ExampleBasedState> {
// 	private readonly attributesSeparator = ':';

// 	constructor(
// 		private http: HttpClient, 
// 		private configurationService: ConfigurationService, 
// 		private treebankService: TreebankService,
// 		private treebankSelectionService: TreebankSelectionService,
// 	) {
// 		super();
// 	}

// 	protected get urlState$(): Observable<QueryParams> {
// 		return this.state$.pipe(skip(1), take(1), first());
// 	}

	
// 	// we want to expose the loading state on the treebank itself maybe, 
// 	// perhaps we can create a stub-stub version of the treebank that we can create from the url.
// 	// the components can then use this to show a loading state.

// 	decodeGlobalState(queryParams: Record<string, any>): ExampleBasedState {
// 		let attributes: string[];
// 		let isCustomXPath: boolean;
// 		if (Array.isArray(queryParams.attributes)) {
// 			// fallback for old URLs
// 			attributes = queryParams.attributes;
// 			isCustomXPath = true; // preserve the existing XPath
// 		} else {
// 			attributes = queryParams.attributes?.split(this.attributesSeparator);
// 			isCustomXPath = this.decodeBool(queryParams.isCustomXPath)
// 		}

// 		// ideally you have the selected treebanks here, or nothing makes any sense.
// 		// so we need to load the treebanks first, and then load the state (if there is a selection in the query params)
// 		// in the selection component, we want to 

// 		return {
// 			treebanks: new TreebankService(this.http, this.configurationService),
// 			selection: new TreebankSelection({}),
// 			xpath: queryParams.xpath || undefined,
// 			inputSentence: queryParams.inputSentence || undefined,
// 			isCustomXPath,
// 			attributes: this.alpinoService.attributesFromString(attributes),
// 			retrieveContext: this.decodeBool(queryParams.retrieveContext),
// 			respectOrder: this.decodeBool(queryParams.respectOrder),
// 			ignoreTopNode: this.decodeBool(queryParams.ignoreTopNode)
// 		};


// 		// need to wait a bit for the selection etc to become available.
// 		// ideally we only want to load the treebanks when we need them


// 		// what is the flow here
// 		// user clicks a treebank to select it
// 		// we async load it, then process the selection
// 		// all is good in the world

// 		// but what if we have a query param that selects a treebank
// 		// then we can already return the state, but without the treebanks/selection.
// 		// we can then load the treebanks, process the selection async

// 		// we need a second function that performs all required async actions to get the state ready
// 		// after that, we can jump to the correct step, as the state should be valid

// 	}
// }


// we need some notion of a State object of some sort.
// we can create a state manager that exposes some of it.

