import {BehaviorSubject} from 'rxjs';

abstract class ServiceWithStream<T extends object> {
	protected _state: BehaviorSubject<Readonly<T>>;
	public get state$() {
		return this._state.asObservable();
	}
	protected get state(): T {
		const self = this;


		function createProxy(
			parent: any,
			parentProp?: string | symbol,
			actualObjectInProp?: any
		) {

      function isObject(o: any): o is object { return o?.constructor === Object }
      function isArray(o: any): o is any[] { return Array.isArray(o); }

			// we want to return a proxy that updates the parent
			// because we want to replace the master stream object in the root proxy

			const isRoot = !parentProp;
			return new Proxy(actualObjectInProp || parent, {
				set: (target, property, value) => {
          if (isRoot) {
						// target should be parent.
						// property+value should be direct child.
						self._state.next({ ...parent, [property]: value });
					} else if (isObject(actualObjectInProp)) {
						// propagate upward.
						// this should eventually call the root setter.
						parent[parentProp] = { ...actualObjectInProp, [property]: value };
					} else if (isArray(actualObjectInProp)) {
            const newArray = [...actualObjectInProp]
            newArray[property] = value;
            parent[parentProp] = newArray;
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
          else if (Array.isArray(actualObjectInTarget)) {
            return createProxy(receiver, property, actualObjectInTarget)
          }
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

const exampleState = {
  a: {
    b: {
      c: [] as string[],
      d: '',
      e: 0
    }
  },
  f: {} as Record<string, string>
}

class StateTest extends ServiceWithStream<typeof exampleState> {
  constructor() {
    super(exampleState)
  }

  

  setC(newC: string[]) { this.state.a.b.c = newC; }
  modifyC(value: string, index: number) {this.state.a.b.c[index] = value;}
  callOnC() { 
    this.state.a.b.c.push('testCallOnC')
  }
  setD(value: string) { this.state.a.b.d = value }
  setE(value: number) { this.state.a.b.e = value }
  addF(key: string, value: any) { this.state.f[key] = value }
}

const inst = new StateTest();
console.log('subscribe')
inst.state$.subscribe(newState => {
  console.log(JSON.stringify(newState));
})

console.log('setC')
inst.setC(['test']);
console.log('modifyC')
inst.modifyC('test2', 1);
console.log('callOnC')
inst.callOnC()
console.log('setD')
inst.setD('test3');
console.log('setE')
inst.setE(2);
console.log('addF')
inst.addF('key', 'value');