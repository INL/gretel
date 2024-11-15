import { BehaviorSubject, Observable } from "rxjs";

export type QueryParams = Record<string, string|object[]|Record<string, string>>;

/** Generic class that can hold some state and watch it for changes, and automatically emit the new state on the state$ observable */
export default abstract class ServiceWithStream<T> {
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

export class TransitionResult {
	constructor(public ok: boolean, public error?: string) {}
	static OK = new TransitionResult(true);
	static error(message: string): TransitionResult {return new TransitionResult(false, message);}
}