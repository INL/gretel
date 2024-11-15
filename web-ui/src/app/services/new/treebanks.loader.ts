import { HttpClient } from "@angular/common/http";
import { FuzzyNumber } from "src/app/treebank";

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

export type TreebankStub = {
	state: 'stub';
	loading: boolean;

	provider: string;
	id: string;
}
export type TreebankBase = Omit<TreebankStub, 'state'>&{
	state: 'partial'
	loading: boolean;

	displayName: string;
	description: string;
	multiOption: boolean;

	/** user id, email, whatever. */
	owner?: string;
}
export type TreebankFull = Omit<TreebankBase, 'state'>&{
	state: 'loaded';
	loading: boolean;

	components: Record<string, Component>;
	variants: ComponentSet[];
	groups: ComponentSet[];
	// TODO
	// metadata: Record<string, MetadataDefinition>;
}

export type Treebank = TreebankStub|TreebankBase|TreebankFull;


export abstract class TreebankLoader {
	constructor(protected http: HttpClient, public provider: string, protected baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}

	abstract loadPreviews(): Promise<Treebank[]>;
	abstract loadTreebank(treebank: Treebank): Promise<TreebankFull>;
	abstract loadTreebanks(treebanks: Treebank[]): Promise<TreebankFull[]>;

	/** Helper function to parse the components returned by the server and create convenient types for the interface. */
	protected createComponents<T>(p: {
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
}

export namespace LegacyBuiltin {
	type TreebanksResponse = {
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
	
	export class TreebankLoaderLegacy extends TreebankLoader {
		private treebanksUrl(): string { return this.baseUrl + '/configured_treebanks' }

		async loadPreviews(): Promise<Treebank[]> {
			const response = await this.http.get<TreebanksResponse>(this.treebanksUrl()).toPromise();
			return Object.entries(response).map(([id, treebank]) => ({
				provider: this.provider, 
				id, 
				description: treebank.description,
				displayName: treebank.title, 
				multiOption: treebank.multioption ?? false, 
				...this.createComponents({
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
}


export namespace LegacyUploads {
	type TreebankResponse = Array<{
		email: string;
		id: string;
		processed: string;
		public: '1' | '0';
		title: string;
		uploaded: string;
		user_id: string;
	}>

	type ComponentResponse = Array<{
		basex_db: string;
		nr_sentences: string;
		nr_words: string;
		slug: string;
		title: string;
	}>

	
	export class TreebankLoaderLegacyUpload extends TreebankLoader {
		private previewUrl(): string { return this.baseUrl + '/index.php/api/treebank/'; }
		private componentsUrl(treebank: {id: string}) { return `${this.baseUrl}/treebank/show/${encodeURIComponent(treebank.id)}/`; }
		private metadataUrl(treebank: {id: string}) { return `${this.baseUrl}/treebank/metadata/${encodeURIComponent(treebank.id)}/`; }

		async loadPreviews(): Promise<Treebank[]> {
			return this.http.get<TreebankResponse>(this.previewUrl()).toPromise()
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

			return this.http.get<ComponentResponse>(this.componentsUrl(treebank)).toPromise()
			.then<TreebankFull>(r => ({
				...treebank,
				...this.createComponents({
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

}

export namespace Django {
	type TreebankResponse = Array<{
		slug: string;
		title: string;
		description: string;
		url_more_info: string;
	}>

	type ComponentResponse = Array<{
		description: string;
		group: string;
		nr_sentences: number;
		nr_words: number;
		slug: string;
		title: string;
		variant: string;
	}>
	
	export class TreebankLoaderDjango extends TreebankLoader {
		private previewUrl() { return `${this.baseUrl}/treebanks/treebank/`; }
		private componentsUrl(treebank: {id: string}) { return `${this.baseUrl}/treebanks/${treebank.id}/components/`; }
		
		async loadPreviews(): Promise<Treebank[]> {
			const response = await this.http.get<TreebankResponse>(this.previewUrl()).toPromise();
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
			
			const response = this.http.get<ComponentResponse>(this.componentsUrl(treebank)).toPromise();
			return response.then<TreebankFull>(r => ({
				...treebank,
				...this.createComponents({
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
}




