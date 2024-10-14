import { HttpClient } from "@angular/common/http";
import { FuzzyNumber, TreebankComponent } from "../treebank";
import _, { countBy, create } from "lodash";
import { ConfigurationService } from "./configuration.service";
import { BehaviorSubject, filter, first, firstValueFrom, ignoreElements, Observable, skip, skipUntil, Subject, take, takeUntil } from "rxjs";
import { query } from "@angular/animations";
import { TokenAttributes } from "../models/matrix";
import { FilterValues } from "./results.service";

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

type TreebankBase = {
	provider: string;
	id: string;
	displayName: string;
	description: string;
	multiOption: boolean;

	/** user id, email, whatever. */
	owner?: string;
}

type TreebankLoading = TreebankBase&{state: 'loading'};
type TreebankStub = TreebankBase&{state: 'stub'};
type TreebankLoaded = TreebankBase&{
	state: 'loaded';
	components: Record<string, Component>;
	variants: ComponentSet[];
	groups: ComponentSet[];
}

export type Treebank = Readonly<TreebankStub>|Readonly<TreebankLoaded>|Readonly<TreebankLoading>;


// hoe doen we metadata discovery
// want op dit moment wordt de metadata uit de resultaten gehaald
// maar misschien willen we de metadata alvast laten zien?
// of we geven er niets om, en laden de metadata gewoon niet uit de backend
// maar creëren de filters op basis van de facetten.
// dan hebben we wel geen display names en descriptions maar is dat erg?
// hebben we nu ook niet.

type TreebankSelectionState = Readonly<{
	id: string;
	provider: string;
	selected: boolean;
	components: ReadonlySet<string>;
}>

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

type TreebankSelectionServiceState = {
	[provider: string]: {
		[id: string]: TreebankSelectionState;
	}
}

abstract class ServiceWithStream<T extends object> {
	protected _state: BehaviorSubject<Readonly<T>>;
	public get state$() {
		return this._state.asObservable();
	}
	protected get state(): T {
		const self = this;

		// if we return a proxy, and we use it once, the object in the stream will be updated
		// however, the object the proxy is based on will still be the old value.

		// we need to memoize the path inside the setter
		// and then update the object when we have the entire path
		// but how in the world do we do this.

		function createProxy(
			parent: any,
			parentProp?: string | symbol,
			actualObjectInProp?: any
		) {
			const isRoot = !parentProp;
			return new Proxy(actualObjectInProp || parent, {
				set: (target, property, value) => {
					if (isRoot) {
						// target should be parent.
						// property+value should be direct child.
						self._state.next({ ...parent, [property]: value });
					} else {
						// somehow value becomes a proxy sometimes
						// which is not what we want
						// but too tired to reason about this now

						// propagate upward.
						// this should eventually call the root setter.
						parent[parentProp] = { ...parent[parentProp], [property]: value };
					}
					return true;
				},
				get: (target, property, receiver) => {
					const actualObjectInTarget = isRoot
						? parent[property]
						: actualObjectInProp[property];
					// for the root: target === parent and is not a proxy
					// we want to make sure we pass ourselves down if we're the root.
					if (actualObjectInTarget.constructor === Object)
						return createProxy(receiver, property, actualObjectInTarget);
					else return actualObjectInTarget;
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
	constructor() {
		super({})
	}

	private getOrCreateState(provider: string, id: string): TreebankSelectionState {
		return this.state[provider]?.[id] || {id, provider, selected: false, components: new Set()};
	}

	private allSelected(state: TreebankSelectionState, components: string[]): boolean {
		return components.every(c => state.components.has(c));
	}

	private toggleSelection(provider: string, id: string, state: TreebankSelectionState, select: boolean, components: string[]) {
		const newState = this.getOrCreateState(provider, id);


		const newComponentState = new Set(state.components);
		if (components.length && select && !treebank.multiOption) {
			newComponentState.clear();
		}
		if (select) components.forEach(c => newComponentState.add(c));
		else components.forEach(c => newComponentState.delete(c));
		return {...state, selected: newComponentState.size > 0, components: newComponentState};
	}

	private getIds(components: Array<Component|undefined>) {
		return components.filter(c => c && !c.disabled).map(c => c.id);
	}

	public serialize(): Record<string, Record<string, string[]>> {
		const result: Record<string, Record<string, string[]>> = {};
		this.state.forEach((state, treebank) => {
			if (!state.selected || !state.components.size) return;
			const providerResult = result[treebank.provider] = result[treebank.provider] || {};
			providerResult[treebank.id] = Array.from(state.components);
		});
		return result;
	}

	public deserialize(treebanks: TreebankLoaded[], data: Record<string, Record<string, string[]>>) {
		this.state.clear();
		for (const provider in data) {
			for (const id in data[provider]) {
				const treebank = treebanks.find(tb => tb.provider === provider && tb.id === id);
				if (!treebank) { 
					console.warn(`Could not restrore selection for treebank ${provider}:${id} because it doesn't exist.`);
					continue; 
				}
				const state = this.getOrCreateState(treebank);
				const selectedComponnets = data[provider][id];
				this.toggleSelection(treebank, state, true, selectedComponnets);
			}
		}
	}

	public selectTreebank(treebank: TreebankLoaded, newState?: boolean) {
		const state = this.state.get(treebank);
		state.selected = newState ?? state.selected;
	}

	public selectSubset(treebank: TreebankLoaded, variant: ComponentSet, newState?: boolean) {
		const state = this.getOrCreateState(treebank);
		const ids = this.getIds(variant.components);
		newState = newState ?? !this.allSelected(state, ids);
		this.toggleSelection(treebank, state, newState, ids);
	}

	public selectGroup(treebank: TreebankLoaded, group: ComponentSet, newState?: boolean) {
		const state = this.getOrCreateState(treebank);
		const ids = this.getIds(group.components);
		newState = newState ?? !this.allSelected(state, ids);
		this.toggleSelection(treebank, state, newState, ids);
	}

	public selectComponent(treebank: TreebankLoaded, component: Component, newState?: boolean) {
		const state = this.getOrCreateState(treebank);
		newState = newState ?? !state.components.has(component.id);
		this.toggleSelection(treebank, state, newState, [component.id]);
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
}): Pick<TreebankLoaded, 'components'|'variants'|'groups'> { 
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
	abstract loadTreebank(treebank: Treebank): Promise<TreebankLoaded>;
	abstract loadTreebanks(treebanks: Treebank[]): Promise<TreebankLoaded[]>;
}

class TreebankLoaderDjango extends TreebankLoader {
	private previewUrl() { return `${this.baseUrl}/treebanks/treebank/`; }
	private componentsUrl(treebank: TreebankBase) { return `${this.baseUrl}/treebanks/${treebank.id}/components/`; }
	
	async loadPreviews(): Promise<Treebank[]> {
		const response = await this.http.get<Django.TreebankResponse>(this.previewUrl()).toPromise();
		return response.map(({slug, title, description, url_more_info}) => ({
			provider: 'django', 
			id: slug, 
			description,
			displayName: title, 
			multiOption: true, 
			owner: '', 
			state: 'stub'
		}));
	}

	async loadTreebank(treebank: Treebank): Promise<TreebankLoaded> {
		if (treebank.state === 'loaded') return treebank;
		const response = this.http.get<Django.ComponentResponse>(this.componentsUrl(treebank)).toPromise();
		return response.then<TreebankLoaded>(r => ({
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
	
	async loadTreebanks(treebanks: Treebank[]): Promise<TreebankLoaded[]> {
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
		}));
	}

	async loadTreebank(treebank: Treebank): Promise<TreebankLoaded> {
		return treebank as TreebankLoaded;
	}
	async loadTreebanks(treebanks: Treebank[]): Promise<TreebankLoaded[]> {
		return treebanks as TreebankLoaded[];
	}
}

class TreebankLoaderLegacyUpload extends TreebankLoader {
	private previewUrl(): string { return this.baseUrl + '/index.php/api/treebank/'; }
	private componentsUrl(treebank: TreebankBase) { return `${this.baseUrl}/treebank/show/${encodeURIComponent(treebank.id)}/`; }
	private metadataUrl(treebank: TreebankBase) { return `${this.baseUrl}/treebank/metadata/${encodeURIComponent(treebank.id)}/`; }

	loadPreviews(): Promise<Treebank[]> {
		return this.http.get<LegacyUpload.TreebankResponse>(this.previewUrl()).toPromise()
		.then<Treebank[]>(uploads => 
			uploads.map(u => ({
				provider: 'upload',
				id: u.id,
				description: '',
				displayName: u.title,
				multiOption: true,
				owner: u.email,
				state: 'stub',
			})
		));
	}
	loadTreebank(treebank: Treebank): Promise<TreebankLoaded> {
		return this.http.get<LegacyUpload.ComponentResponse>(this.componentsUrl(treebank)).toPromise()
		.then<TreebankLoaded>(r => ({
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
	loadTreebanks(treebanks: Treebank[]): Promise<TreebankLoaded[]> {
		return Promise.all(treebanks.map(tb => this.loadTreebank(tb)));
	}
}

class TreebankService {
	private treebanks: Treebank[] = [];
	private loaders: TreebankLoader[] = [];
	
	constructor(
		private http: HttpClient,
		private configurationService: ConfigurationService,
	) {
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

	public treebanks$ = new BehaviorSubject<Treebank[]>(this.treebanks);
	public loading$ = new BehaviorSubject<boolean>(false);
	private loadingFinished$ = new Subject<TreebankLoaded>();
	private untilLoaded$(tb: Treebank) {
		const loaded = this.loadingFinished$.pipe(filter(tb => tb.provider === tb.provider && tb.id === tb.id));
		return this.loadingFinished$.pipe(takeUntil(loaded), ignoreElements());
	}

	private async loadPreviews() {
		return Promise.all(this.loaders.map(async loader => {
			const previews = await loader.loadPreviews();
			this.treebanks.push(...previews);
			this.treebanks$.next(this.treebanks);
		}))
	}

	public async loadTreebank(treebank: Treebank): Promise<void> {
		if (treebank.state === 'loaded') 
			return;
		if (treebank.state === 'loading') 
			return this.untilLoaded$(treebank).toPromise();

		const index = this.treebanks.indexOf(treebank);
		const loader = this.loaders.find(l => l.provider === treebank.provider);
		
		this.treebanks[index] = { ...treebank, state: 'loading' };
		this.treebanks$.next(this.treebanks);
		this.treebanks[index] = await loader.loadTreebank(treebank);
		this.treebanks$.next(this.treebanks);
	}
}


// Selection service is annoying, because it needs the loaded treebanks
// but maybe we can have some sort of a getSelection and getSelectionWithTreebanks where one is async
// and the other one is not.
// e.g. for sending to the server and for rendering.


type RecursivePartial<T> = { [P in keyof T]?: RecursivePartial<T[P]>; }
abstract class StateManager<T> {
	protected readonly _state$: BehaviorSubject<Readonly<T>>;
	public get state$(): Observable<Readonly<T>> { return this._state$.asObservable();  }

	constructor(queryParams: Record<string, any>) {
		this._state$ = new BehaviorSubject<T>(this.decodeGlobalState(queryParams));
	}

	public async update(modifier: RecursivePartial<T>) {
		const newState = { ...this._state$.value, ...modifier };
		this._state$.next(newState);
	}

	abstract decodeGlobalState(queryParams: Record<string, any>): T;
	abstract encodeGlobalState(state: T): Record<string, any>;
	abstract performAsyncLoadingActions(state: T): Promise<void>;

	protected decodeBool(value: string|undefined) { return value === '1' ? true : value === '0' ? false : undefined; }
	protected encodeBool(value: boolean|undefined) { return value === true ? '1' : value === false ? '0' : undefined; }
}

type GlobalStateBase = {
	treebanks: TreebankService;
	selection: TreebankSelection;
	
	currentStep: number;
}

type ExampleBasedState = GlobalStateBase & {
	inputSentence?: string;
	xpath?: string;
	
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

class StateManagerExampleBased extends StateManager<ExampleBasedState> {
	private readonly attributesSeparator = ':';

	constructor(private http: HttpClient, private configurationService: ConfigurationService, queryParams: Record<string, any>) {
		super(queryParams);
	}

	encodeGlobalState(state: ExampleBasedState): Record<string, any> {
		return {};
	}

	
	// we want to expose the loading state on the treebank itself maybe, 
	// perhaps we can create a stub-stub version of the treebank that we can create from the url.
	// the components can then use this to show a loading state.

	decodeGlobalState(queryParams: Record<string, any>): ExampleBasedState {
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

		return {
			treebanks: new TreebankService(this.http, this.configurationService),
			selection: new TreebankSelection({}),
			xpath: queryParams.xpath || undefined,
			inputSentence: queryParams.inputSentence || undefined,
			isCustomXPath,
			attributes: this.alpinoService.attributesFromString(attributes),
			retrieveContext: this.decodeBool(queryParams.retrieveContext),
			respectOrder: this.decodeBool(queryParams.respectOrder),
			ignoreTopNode: this.decodeBool(queryParams.ignoreTopNode)
		};


		// need to wait a bit for the selection etc to become available.
		// ideally we only want to load the treebanks when we need them


		// what is the flow here
		// user clicks a treebank to select it
		// we async load it, then process the selection
		// all is good in the world

		// but what if we have a query param that selects a treebank
		// then we can already return the state, but without the treebanks/selection.
		// we can then load the treebanks, process the selection async

		// we need a second function that performs all required async actions to get the state ready
		// after that, we can jump to the correct step, as the state should be valid

	}
}


// we need some notion of a State object of some sort.
// we can create a state manager that exposes some of it.


abstract class ComponentWithStateAndSteps<T> {
	constructor(private steps: Step<T>[]) {}
}

/** A step has a number and a function that performs the necessary actions when entering a step */
abstract class Step<T> {
	constructor(public number: number) {}
	// Makes sure the step is entered correctly
	abstract canLeaveStep(state: T): boolean;
	abstract canEnterStep(state: T): boolean;
	abstract enterStep(state: T): T;
	abstract leaveStep(state: T): T;
}

