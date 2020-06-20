import {
    IEnhancer,
    IEqualsComparer,
    IObservableArray,
    IObservableDecorator,
    IObservableMapInitialValues,
    IObservableSetInitialValues,
    IObservableObject,
    IObservableValue,
    ObservableMap,
    ObservableSet,
    ObservableValue,
    createDecoratorForEnhancer,
    createDynamicObservableObject,
    createObservableArray,
    deepEnhancer,
    extendObservable,
    fail,
    isES6Map,
    isES6Set,
    isObservable,
    isPlainObject,
    refStructEnhancer,
    referenceEnhancer,
    shallowEnhancer,
    getDefaultDecoratorFromObjectOptions,
    extendObservableObjectWithProperties
} from "../internal"

export type CreateObservableOptions = {
    name?: string
    equals?: IEqualsComparer<any>
    deep?: boolean
    defaultDecorator?: IObservableDecorator
    proxy?: boolean
}

// Predefined bags of create observable options, to avoid allocating temporarily option objects
// in the majority of cases
export const defaultCreateObservableOptions: CreateObservableOptions = {
    deep: true,
    name: undefined,
    defaultDecorator: undefined,
    proxy: true
}
Object.freeze(defaultCreateObservableOptions)

// 有效属性包括：deep、name、equals、defaultDecorator、proxy
function assertValidOption(key: string) {
    if (!/^(deep|name|equals|defaultDecorator|proxy)$/.test(key)) {
        fail(`invalid option for (extend)observable: ${key}`)
    }
}

export function asCreateObservableOptions(thing: any): CreateObservableOptions {
    // thing 是 null 或 undefined，使用默认选项
    if (thing === null || thing === undefined) {
        return defaultCreateObservableOptions
    }
    // thing 是 string，作为 name
    if (typeof thing === "string") {
        return { name: thing, deep: true, proxy: true }
    }
    if (process.env.NODE_ENV !== "production") {
        // thing 不是 string，也不是 object，报错
        if (typeof thing !== "object") return fail("expected options object")
        Object.keys(thing).forEach(assertValidOption)
    }
    return thing as CreateObservableOptions
}

// 为 enhancer 创建 decorator
export const deepDecorator = createDecoratorForEnhancer(deepEnhancer)
const shallowDecorator = createDecoratorForEnhancer(shallowEnhancer)
export const refDecorator = createDecoratorForEnhancer(referenceEnhancer)
const refStructDecorator = createDecoratorForEnhancer(refStructEnhancer)

function getEnhancerFromOptions(options: CreateObservableOptions): IEnhancer<any> {
    return options.defaultDecorator
        ? options.defaultDecorator.enhancer
        : options.deep === false
        ? referenceEnhancer
        : deepEnhancer
}

/**
 * Turns an object, array or function into a reactive structure.
 * @param v the value which should become observable.
 */
function createObservable(v: any, arg2?: any, arg3?: any) {
    // @observable someProp;
    if (typeof arguments[1] === "string" || typeof arguments[1] === "symbol") {
        return deepDecorator.apply(null, arguments as any)
    }

    // it is an observable already, done
    if (isObservable(v)) return v

    // something that can be converted and mutated?
    const res = isPlainObject(v)
        ? observable.object(v, arg2, arg3) // 如果是 plain object，用 observable.object 转化
        : Array.isArray(v)
        ? observable.array(v, arg2) // 如果是数组，用 observable.array 转化
        : isES6Map(v)
        ? observable.map(v, arg2) // 如果是 Map，用 observable.map 转化
        : isES6Set(v)
        ? observable.set(v, arg2) // 如果是 Set，用 observable.set 转化
        : v

    // this value could be converted to a new observable data structure, return it
    // 如果转化为一个新的 observable 数据，转化成功，则返回
    if (res !== v) return res

    // otherwise, just box it
    // 否则，转化失败
    fail(
        process.env.NODE_ENV !== "production" &&
            `The provided value could not be converted into an observable. If you want just create an observable reference to the object use 'observable.box(value)'`
    )
}

export interface IObservableFactory {
    // observable overloads
    (value: number | string | null | undefined | boolean): never // Nope, not supported, use box
    (target: Object, key: string | symbol, baseDescriptor?: PropertyDescriptor): any // decorator
    <T = any>(value: T[], options?: CreateObservableOptions): IObservableArray<T>
    <T = any>(value: Set<T>, options?: CreateObservableOptions): ObservableSet<T>
    <K = any, V = any>(value: Map<K, V>, options?: CreateObservableOptions): ObservableMap<K, V>
    <T extends Object>(
        value: T,
        decorators?: { [K in keyof T]?: Function },
        options?: CreateObservableOptions
    ): T & IObservableObject
}

export interface IObservableFactories {
    box<T = any>(value?: T, options?: CreateObservableOptions): IObservableValue<T>
    array<T = any>(initialValues?: T[], options?: CreateObservableOptions): IObservableArray<T>
    set<T = any>(
        initialValues?: IObservableSetInitialValues<T>,
        options?: CreateObservableOptions
    ): ObservableSet<T>
    map<K = any, V = any>(
        initialValues?: IObservableMapInitialValues<K, V>,
        options?: CreateObservableOptions
    ): ObservableMap<K, V>
    object<T = any>(
        props: T,
        decorators?: { [K in keyof T]?: Function },
        options?: CreateObservableOptions
    ): T & IObservableObject

    /**
     * Decorator that creates an observable that only observes the references, but doesn't try to turn the assigned value into an observable.ts.
     */
    ref: IObservableDecorator
    /**
     * Decorator that creates an observable converts its value (objects, maps or arrays) into a shallow observable structure
     */
    shallow: IObservableDecorator
    deep: IObservableDecorator
    struct: IObservableDecorator
}

const observableFactories: IObservableFactories = {
    box<T = any>(value?: T, options?: CreateObservableOptions): IObservableValue<T> {
        if (arguments.length > 2) incorrectlyUsedAsDecorator("box")
        const o = asCreateObservableOptions(options)
        return new ObservableValue(value, getEnhancerFromOptions(o), o.name, true, o.equals)
    },
    array<T = any>(initialValues?: T[], options?: CreateObservableOptions): IObservableArray<T> {
        if (arguments.length > 2) incorrectlyUsedAsDecorator("array")
        const o = asCreateObservableOptions(options)
        return createObservableArray(initialValues, getEnhancerFromOptions(o), o.name) as any
    },
    map<K = any, V = any>(
        initialValues?: IObservableMapInitialValues<K, V>,
        options?: CreateObservableOptions
    ): ObservableMap<K, V> {
        if (arguments.length > 2) incorrectlyUsedAsDecorator("map")
        const o = asCreateObservableOptions(options)
        return new ObservableMap<K, V>(initialValues, getEnhancerFromOptions(o), o.name)
    },
    set<T = any>(
        initialValues?: IObservableSetInitialValues<T>,
        options?: CreateObservableOptions
    ): ObservableSet<T> {
        if (arguments.length > 2) incorrectlyUsedAsDecorator("set")
        const o = asCreateObservableOptions(options)
        return new ObservableSet<T>(initialValues, getEnhancerFromOptions(o), o.name)
    },
    object<T = any>(
        props: T,
        decorators?: { [K in keyof T]: Function },
        options?: CreateObservableOptions
    ): T & IObservableObject {
        // arguments[1] 是 string，表示被用作装饰器了
        if (typeof arguments[1] === "string") incorrectlyUsedAsDecorator("object")
        const o = asCreateObservableOptions(options)
        // proxy 选项为 false
        if (o.proxy === false) {
            return extendObservable({}, props, decorators, o) as any
        } else {
            // 获取默认 decorator
            const defaultDecorator = getDefaultDecoratorFromObjectOptions(o)
            // 基于 {} 创建 base
            // base 的 $mobx 属性为对应的 observableObjectAdministration
            const base = extendObservable({}, undefined, undefined, o) as any
            // 基于 base 创建 dynamic observable object
            // 创建 base 的 proxy，并挂载再 base $mobx 属性 的 proxy 属性上
            const proxy = createDynamicObservableObject(base)
            // 使用 props 扩展 proxy
            // 往 proxy 也就是 base 的 observableObjectAdministration 中添加对应的属性值
            // observableObjectAdministration 的 values 属性是一个 Map，key 是 props 的各个属性，value是属性对应的 observableValue
            // 这里也就是把 props的各个属性值转化为 observableValue 并添加到 values 的 Map 中
            extendObservableObjectWithProperties(proxy, props, decorators, defaultDecorator)
            // 返回 proxy
            return proxy
        }
    },
    ref: refDecorator,
    shallow: shallowDecorator,
    deep: deepDecorator,
    struct: refStructDecorator
} as any

export const observable: IObservableFactory &
    IObservableFactories & {
        enhancer: IEnhancer<any>
    } = createObservable as any

// weird trick to keep our typings nicely with our funcs, and still extend the observable function
Object.keys(observableFactories).forEach(name => (observable[name] = observableFactories[name]))

function incorrectlyUsedAsDecorator(methodName) {
    fail(
        // process.env.NODE_ENV !== "production" &&
        `Expected one or two arguments to observable.${methodName}. Did you accidentally try to use observable.${methodName} as decorator?`
    )
}
