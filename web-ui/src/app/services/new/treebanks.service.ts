import { HttpClient } from "@angular/common/http";
import { ConfigurationService } from "../configuration.service";
import { BehaviorSubject, filter, first, Observable, of, Subject, } from "rxjs";
import { TokenAttributes } from "../../models/matrix";
// import { FilterValues } from "./results.service";
import { FilterValues } from "../results.service";
import { Treebank, TreebankFull, TreebankLoader, Django, LegacyBuiltin, LegacyUploads } from "./treebanks.loader";
import ServiceWithStream, { QueryParams } from "./base.service";



export default class TreebankService extends ServiceWithStream<Treebank[]> {
	public get url$(): Observable<QueryParams> { return of({}); }
	async decodeUrl(queryParams: QueryParams): Promise<void> { }
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
			this.loaders.push(new Django.TreebankLoaderDjango(http, 'django', djangoUrl));
			if (legacyUploadUrl) this.loaders.push(new LegacyUploads.TreebankLoaderLegacyUpload(http, 'legacy_upload', legacyUploadUrl));
			Object.entries(legacyProviders).forEach(([provider_id, url]) => {
				this.loaders.push(new LegacyBuiltin.TreebankLoaderLegacy(http, provider_id, url));
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