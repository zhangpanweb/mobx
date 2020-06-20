import {
    $mobx,
    ObservableObjectAdministration,
    fail,
    isAtom,
    isComputedValue,
    isObservableArray,
    isObservableMap,
    isObservableObject,
    isReaction
} from "../internal"

function _isObservable(value, property?: string): boolean {
    // 排除 null 和 undefined
    if (value === null || value === undefined) return false
    if (property !== undefined) {
        if (
            process.env.NODE_ENV !== "production" &&
            (isObservableMap(value) || isObservableArray(value))
        )
            return fail(
                "isObservable(object, propertyName) is not supported for arrays and maps. Use map.has or array.length instead."
            )
        if (isObservableObject(value)) {
            return (<ObservableObjectAdministration>(value as any)[$mobx]).values.has(property)
        }
        return false
    }
    // For first check, see #701
    // property 为 undefined， 只检测 value
    return (
        isObservableObject(value) || // 是 observable object
        !!value[$mobx] || // 有 $mobx 属性
        isAtom(value) || // 是 Atom
        isReaction(value) || // 是 Reaction
        isComputedValue(value) // 是 ComputedValue
    )
}

export function isObservable(value: any): boolean {
    if (arguments.length !== 1)
        fail(
            process.env.NODE_ENV !== "production" &&
                `isObservable expects only 1 argument. Use isObservableProp to inspect the observability of a property`
        )
    return _isObservable(value)
}

export function isObservableProp(value: any, propName: string): boolean {
    if (typeof propName !== "string")
        return fail(
            process.env.NODE_ENV !== "production" && `expected a property name as second argument`
        )
    return _isObservable(value, propName)
}
