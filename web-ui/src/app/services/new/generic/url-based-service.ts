import { Observable } from 'rxjs';

export type QueryParams = Record<string, string|object[]|Record<string, string>>;



export interface UrlBasedState<Q extends QueryParams> {
	decodeUrl(urlParams: Q): Promise<TransitionResult>;
	url$: Observable<QueryParams>;
}