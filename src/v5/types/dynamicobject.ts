import {
    $mobx,
    Atom,
    IIsObservableObject,
    ObservableObjectAdministration,
    fail,
    mobxDidRunLazyInitializersSymbol,
    set
} from "../internal"

// 通过 $mobx 属性获取 target 的 adm
function getAdm(target): ObservableObjectAdministration {
    return target[$mobx]
}

function isPropertyKey(val) {
    return typeof val === "string" || typeof val === "number" || typeof val === "symbol"
}

// Optimization: we don't need the intermediate objects and could have a completely custom administration for DynamicObjects,
// and skip either the internal values map, or the base object with its property descriptors!
const objectProxyTraps: ProxyHandler<any> = {
    has(target: IIsObservableObject, name: PropertyKey) {
        if (name === $mobx || name === "constructor" || name === mobxDidRunLazyInitializersSymbol)
            return true
        const adm = getAdm(target)
        // MWE: should `in` operator be reactive? If not, below code path will be faster / more memory efficient
        // TODO: check performance stats!
        // if (adm.values.get(name as string)) return true
        if (isPropertyKey(name)) return adm.has(name)
        return (name as any) in target
    },
    get(target: IIsObservableObject, name: PropertyKey) {
        // 如果需要的是 mobx 内部是一些属性，可以直接返回
        if (name === $mobx || name === "constructor" || name === mobxDidRunLazyInitializersSymbol)
            return target[name]
        // 获取 adm
        const adm = getAdm(target)
        const observable = adm.values.get(name)
        if (observable instanceof Atom) {
            // 如果 observable 是 Atom，通过 observable.get 获取值
            const result = (observable as any).get()
            if (result === undefined) {
                // This fixes #1796, because deleting a prop that has an
                // undefined value won't retrigger a observer (no visible effect),
                // the autorun wouldn't subscribe to future key changes (see also next comment)
                adm.has(name as any)
            }
            return result
        }
        // make sure we start listening to future keys
        // note that we only do this here for optimization
        if (isPropertyKey(name)) adm.has(name)
        // 否则 通过 target[name] 获取值
        return target[name]
    },
    set(target: IIsObservableObject, name: PropertyKey, value: any) {
        // 验证 name 是 string 或 number 或 symbols
        if (!isPropertyKey(name)) return false
        set(target, name, value)
        return true
    },
    deleteProperty(target: IIsObservableObject, name: PropertyKey) {
        if (!isPropertyKey(name)) return false
        const adm = getAdm(target)
        adm.remove(name)
        return true
    },
    ownKeys(target: IIsObservableObject) {
        const adm = getAdm(target)
        adm.keysAtom.reportObserved()
        return Reflect.ownKeys(target)
    },
    preventExtensions(target) {
        fail(`Dynamic observable objects cannot be frozen`)
        return false
    }
}

export function createDynamicObservableObject(base) {
    const proxy = new Proxy(base, objectProxyTraps) // 创建 proxy
    base[$mobx].proxy = proxy // 将 proxy 挂载在 base $mobx 属性的 proxy 属性上
    return proxy // 返回 proxy
}
