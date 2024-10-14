import { BehaviorSubject } from 'rxjs';
class ServiceWithStream {
    _state;
    get state$() {
        return this._state.asObservable();
    }
    get state() {
        const self = this;
        function createProxy(parent, parentProp, actualObjectInProp) {
            function isObject(o) { return o?.constructor === Object; }
            function isArray(o) { return Array.isArray(o); }
            // we want to return a proxy that updates the parent
            // because we want to replace the master stream object in the root proxy
            const isRoot = !parentProp;
            return new Proxy(actualObjectInProp || parent, {
                set: (target, property, value) => {
                    if (isRoot) {
                        // target should be parent.
                        // property+value should be direct child.
                        self._state.next({ ...parent, [property]: value });
                    }
                    else if (isObject(actualObjectInProp)) {
                        // propagate upward.
                        // this should eventually call the root setter.
                        parent[parentProp] = { ...actualObjectInProp, [property]: value };
                    }
                    else if (isArray(actualObjectInProp)) {
                        const newArray = [...actualObjectInProp];
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
                        return createProxy(receiver, property, actualObjectInTarget);
                    }
                    else
                        return actualObjectInTarget;
                },
            });
        }
        return createProxy(this._state.value);
    }
    constructor(initialState) {
        this._state = new BehaviorSubject(initialState);
    }
}
const exampleState = {
    a: {
        b: {
            c: [],
            d: '',
            e: 0
        }
    },
    f: {}
};
class StateTest extends ServiceWithStream {
    constructor() {
        super(exampleState);
    }
    setC(newC) { this.state.a.b.c = newC; }
    modifyC(value, index) { this.state.a.b.c[index] = value; }
    callOnC() {
        this.state.a.b.c.push('testCallOnC');
    }
    setD(value) { this.state.a.b.d = value; }
    setE(value) { this.state.a.b.e = value; }
    addF(key, value) { this.state.f[key] = value; }
}
const inst = new StateTest();
console.log('subscribe');
inst.state$.subscribe(newState => {
    console.log(JSON.stringify(newState));
});
console.log('setC');
inst.setC(['test']);
console.log('modifyC');
inst.modifyC('test2', 1);
console.log('callOnC');
inst.callOnC();
console.log('setD');
inst.setD('test3');
console.log('setE');
inst.setE(2);
console.log('addF');
inst.addF('key', 'value');
