import {
    CreateObservableOptions,
    asCreateObservableOptions,
    asObservableObject,
    computedDecorator,
    deepDecorator,
    endBatch,
    fail,
    getPlainObjectKeys,
    invariant,
    isComputed,
    isObservable,
    isObservableMap,
    refDecorator,
    startBatch,
    stringifyKey,
    initializeInstance
} from "../internal"
import { IObservableDecorator } from "./observabledecorator"
import { isPlainObject } from "../utils/utils"

export function extendObservable<A extends Object, B extends Object>(
    target: A,
    properties?: B,
    decorators?: { [K in keyof B]?: Function },
    options?: CreateObservableOptions
): A & B {
    if (process.env.NODE_ENV !== "production") {
        invariant(
            arguments.length >= 2 && arguments.length <= 4,
            "'extendObservable' expected 2-4 arguments"
        )
        // 第一个参数要是对象
        invariant(
            typeof target === "object",
            "'extendObservable' expects an object as first argument"
        )
        // extendObservable 不能用于 map
        invariant(
            !isObservableMap(target),
            "'extendObservable' should not be used on maps, use map.merge instead"
        )
    }

    options = asCreateObservableOptions(options)
    const defaultDecorator = getDefaultDecoratorFromObjectOptions(options)
    initializeInstance(target) // Fixes #1740
    // 基于 target、option.name 和 enhancer 创建 adm，并将 adm 挂载在 target 的 $mobx 属性上
    asObservableObject(target, options.name, defaultDecorator.enhancer) // make sure object is observable, even without initial props
    if (properties)
        extendObservableObjectWithProperties(target, properties, decorators, defaultDecorator)
    return target as any
}

export function getDefaultDecoratorFromObjectOptions(
    options: CreateObservableOptions
): IObservableDecorator {
    return options.defaultDecorator || (options.deep === false ? refDecorator : deepDecorator)
}

export function extendObservableObjectWithProperties(
    target,
    properties,
    decorators,
    defaultDecorator
) {
    if (process.env.NODE_ENV !== "production") {
        invariant(
            !isObservable(properties), // 不能用一个 observable 扩展另外一个 observable
            "Extending an object with another observable (object) is not supported. Please construct an explicit propertymap, using `toJS` if need. See issue #540"
        )
        if (decorators) {
            const keys = getPlainObjectKeys(decorators)
            for (const key of keys) {
                if (!(key in properties!))
                    fail(
                        `Trying to declare a decorator for unspecified property '${stringifyKey(
                            key
                        )}'`
                    )
            }
        }
    }
    startBatch()
    try {
        const keys = getPlainObjectKeys(properties)
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(properties, key)!
            if (process.env.NODE_ENV !== "production") {
                if (!isPlainObject(properties))
                    // extendObservabe 只接受 plain object 作为第二个参数
                    fail(`'extendObservabe' only accepts plain objects as second argument`)
                if (isComputed(descriptor.value))
                    fail(
                        `Passing a 'computed' as initial property value is no longer supported by extendObservable. Use a getter or decorator instead`
                    )
            }
            const decorator =
                decorators && key in decorators
                    ? decorators[key]
                    : descriptor.get // 如果是 getter，使用 computedDecorator
                    ? computedDecorator
                    : defaultDecorator // 否则使用 defaultDecorator
            if (process.env.NODE_ENV !== "production" && typeof decorator !== "function")
                fail(`Not a valid decorator for '${stringifyKey(key)}', got: ${decorator}`)

            const resultDescriptor = decorator!(target, key, descriptor, true)
            if (
                resultDescriptor // otherwise, assume already applied, due to `applyToInstance`
            )
                Object.defineProperty(target, key, resultDescriptor)
        }
    } finally {
        endBatch()
    }
}
