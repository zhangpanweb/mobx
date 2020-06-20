import {
    $mobx,
    Atom,
    ComputedValue,
    IAtom,
    IComputedValueOptions,
    IEnhancer,
    IInterceptable,
    IListenable,
    Lambda,
    ObservableValue,
    addHiddenProp,
    assertPropertyConfigurable,
    createInstanceofPredicate,
    deepEnhancer,
    endBatch,
    getNextId,
    hasInterceptors,
    hasListeners,
    initializeInstance,
    interceptChange,
    invariant,
    isObject,
    isPlainObject,
    isPropertyConfigurable,
    isSpyEnabled,
    notifyListeners,
    referenceEnhancer,
    registerInterceptor,
    registerListener,
    spyReportEnd,
    spyReportStart,
    startBatch,
    stringifyKey,
    globalState
} from "../internal"

export interface IObservableObject {
    "observable-object": IObservableObject
}

export type IObjectDidChange<T = any> =
    | {
          name: PropertyKey
          object: T
          type: "add"
          newValue: any
      }
    | {
          name: PropertyKey
          object: T
          type: "update"
          oldValue: any
          newValue: any
      }
    | {
          name: PropertyKey
          object: T
          type: "remove"
          oldValue: any
      }

export type IObjectWillChange<T = any> =
    | {
          object: T
          type: "update" | "add"
          name: PropertyKey
          newValue: any
      }
    | {
          object: T
          type: "remove"
          name: PropertyKey
      }

export class ObservableObjectAdministration
    implements IInterceptable<IObjectWillChange>, IListenable {
    keysAtom: IAtom
    changeListeners
    interceptors
    private proxy: any
    private pendingKeys: undefined | Map<PropertyKey, ObservableValue<boolean>>

    constructor(
        public target: any,
        public values = new Map<PropertyKey, ObservableValue<any> | ComputedValue<any>>(),
        public name: string,
        public defaultEnhancer: IEnhancer<any>
    ) {
        this.keysAtom = new Atom(name + ".keys")
    }

    read(key: PropertyKey) {
        return this.values.get(key)!.get()
    }

    write(key: PropertyKey, newValue) {
        const instance = this.target
        const observable = this.values.get(key)
        // 如果 observable 是 ComputedValue，调用 set
        if (observable instanceof ComputedValue) {
            observable.set(newValue)
            return
        }

        // intercept
        // 如果有 intercept，调用 intercept
        if (hasInterceptors(this)) {
            const change = interceptChange<IObjectWillChange>(this, {
                type: "update",
                object: this.proxy || instance,
                name: key,
                newValue
            })
            if (!change) return
            newValue = (change as any).newValue
        }
        newValue = (observable as any).prepareNewValue(newValue)

        // notify spy & observers
        if (newValue !== globalState.UNCHANGED) {
            // 如果 newValue 对比原值是有改变的
            const notify = hasListeners(this) // 对这个 observable object 有监听者
            const notifySpy = isSpyEnabled()
            const change =
                notify || notifySpy
                    ? {
                          type: "update",
                          object: this.proxy || instance,
                          oldValue: (observable as any).value,
                          name: key,
                          newValue
                      }
                    : null

            if (notifySpy && process.env.NODE_ENV !== "production")
                spyReportStart({ ...change, name: this.name, key })
            ;(observable as ObservableValue<any>).setNewValue(newValue)
            if (notify) notifyListeners(this, change)
            if (notifySpy && process.env.NODE_ENV !== "production") spyReportEnd()
        }
    }

    has(key: PropertyKey) {
        const map = this.pendingKeys || (this.pendingKeys = new Map())
        let entry = map.get(key)
        if (entry) return entry.get()
        else {
            const exists = !!this.values.get(key)
            // Possible optimization: Don't have a separate map for non existing keys,
            // but store them in the values map instead, using a special symbol to denote "not existing"
            entry = new ObservableValue( // 将 key 是否存在也设置为一个 ObservableValue
                exists,
                referenceEnhancer,
                `${this.name}.${stringifyKey(key)}?`,
                false
            )
            map.set(key, entry)
            return entry.get() // read to subscribe
        }
    }

    addObservableProp(
        propName: PropertyKey,
        newValue,
        enhancer: IEnhancer<any> = this.defaultEnhancer
    ) {
        const { target } = this
        assertPropertyConfigurable(target, propName)

        if (hasInterceptors(this)) {
            const change = interceptChange<IObjectWillChange>(this, {
                object: this.proxy || target,
                name: propName,
                type: "add",
                newValue
            })
            if (!change) return
            newValue = (change as any).newValue
        }
        // 使用新值构建一个 observableValue
        const observable = new ObservableValue(
            newValue,
            enhancer,
            `${this.name}.${stringifyKey(propName)}`,
            false
        )
        // 设置 propName 的值位 observable
        this.values.set(propName, observable)
        newValue = (observable as any).value // observableValue might have changed it

        Object.defineProperty(target, propName, generateObservablePropConfig(propName))
        this.notifyPropertyAddition(propName, newValue)
    }

    // 将一个计算属性增加到 observableObject 中
    addComputedProp(
        propertyOwner: any, // where is the property declared?
        propName: PropertyKey,
        options: IComputedValueOptions<any>
    ) {
        const { target } = this
        options.name = options.name || `${this.name}.${stringifyKey(propName)}`
        // values 设置 propName 和 一个 ComputedValue
        this.values.set(propName, new ComputedValue(options))
        if (propertyOwner === target || isPropertyConfigurable(propertyOwner, propName))
            Object.defineProperty(propertyOwner, propName, generateComputedPropConfig(propName))
    }

    remove(key: PropertyKey) {
        if (!this.values.has(key)) return
        const { target } = this
        if (hasInterceptors(this)) {
            const change = interceptChange<IObjectWillChange>(this, {
                object: this.proxy || target,
                name: key,
                type: "remove"
            })
            if (!change) return
        }
        try {
            startBatch()
            const notify = hasListeners(this)
            const notifySpy = isSpyEnabled()
            const oldObservable = this.values.get(key)
            const oldValue = oldObservable && oldObservable.get()
            oldObservable && oldObservable.set(undefined)
            // notify key and keyset listeners
            this.keysAtom.reportChanged()
            this.values.delete(key)
            if (this.pendingKeys) {
                const entry = this.pendingKeys.get(key)
                if (entry) entry.set(false)
            }
            // delete the prop
            delete this.target[key]
            const change =
                notify || notifySpy
                    ? {
                          type: "remove",
                          object: this.proxy || target,
                          oldValue: oldValue,
                          name: key
                      }
                    : null
            if (notifySpy && process.env.NODE_ENV !== "production")
                spyReportStart({ ...change, name: this.name, key })
            if (notify) notifyListeners(this, change)
            if (notifySpy && process.env.NODE_ENV !== "production") spyReportEnd()
        } finally {
            endBatch()
        }
    }

    illegalAccess(owner, propName) {
        /**
         * This happens if a property is accessed through the prototype chain, but the property was
         * declared directly as own property on the prototype.
         *
         * E.g.:
         * class A {
         * }
         * extendObservable(A.prototype, { x: 1 })
         *
         * classB extens A {
         * }
         * console.log(new B().x)
         *
         * It is unclear whether the property should be considered 'static' or inherited.
         * Either use `console.log(A.x)`
         * or: decorate(A, { x: observable })
         *
         * When using decorate, the property will always be redeclared as own property on the actual instance
         */
        console.warn(
            `Property '${propName}' of '${owner}' was accessed through the prototype chain. Use 'decorate' instead to declare the prop or access it statically through it's owner`
        )
    }

    /**
     * Observes this object. Triggers for the events 'add', 'update' and 'delete'.
     * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/observe
     * for callback details
     */
    observe(callback: (changes: IObjectDidChange) => void, fireImmediately?: boolean): Lambda {
        process.env.NODE_ENV !== "production" &&
            invariant(
                fireImmediately !== true,
                "`observe` doesn't support the fire immediately property for observable objects."
            )
        return registerListener(this, callback)
    }

    intercept(handler): Lambda {
        return registerInterceptor(this, handler)
    }

    notifyPropertyAddition(key: PropertyKey, newValue) {
        const notify = hasListeners(this)
        const notifySpy = isSpyEnabled()
        const change =
            notify || notifySpy
                ? {
                      type: "add",
                      object: this.proxy || this.target,
                      name: key,
                      newValue
                  }
                : null

        if (notifySpy && process.env.NODE_ENV !== "production")
            spyReportStart({ ...change, name: this.name, key })
        if (notify) notifyListeners(this, change)
        if (notifySpy && process.env.NODE_ENV !== "production") spyReportEnd()
        if (this.pendingKeys) {
            const entry = this.pendingKeys.get(key)
            if (entry) entry.set(true)
        }
        this.keysAtom.reportChanged()
    }

    getKeys(): PropertyKey[] {
        this.keysAtom.reportObserved()
        // return Reflect.ownKeys(this.values) as any
        const res: PropertyKey[] = []
        for (const [key, value] of this.values) if (value instanceof ObservableValue) res.push(key)
        return res
    }
}

export interface IIsObservableObject {
    $mobx: ObservableObjectAdministration
}

// 把 target 转化成一个 observable object
// 在 target 的 $mobx 属性上挂载 target 对应的 ObservableObjectAdministration
// 返回这个 ObservableObjectAdministration
export function asObservableObject(
    target: any,
    name: PropertyKey = "",
    defaultEnhancer: IEnhancer<any> = deepEnhancer
): ObservableObjectAdministration {
    // 如果已经有 $mobx，返回
    if (Object.prototype.hasOwnProperty.call(target, $mobx)) return target[$mobx]

    process.env.NODE_ENV !== "production" &&
        invariant(
            Object.isExtensible(target), // 如果 target 是不可扩展的，报错
            "Cannot make the designated object observable; it is not extensible"
        )

    // 获取 name
    if (!isPlainObject(target))
        name = (target.constructor.name || "ObservableObject") + "@" + getNextId()
    if (!name) name = "ObservableObject@" + getNextId()

    const adm = new ObservableObjectAdministration(
        target,
        new Map(),
        stringifyKey(name),
        defaultEnhancer
    )
    // 将 adm 挂载在 target 的 $mobx 属性上
    addHiddenProp(target, $mobx, adm)
    // 返回 adm
    return adm
}

const observablePropertyConfigs = Object.create(null)
const computedPropertyConfigs = Object.create(null)

export function generateObservablePropConfig(propName) {
    return (
        observablePropertyConfigs[propName] ||
        (observablePropertyConfigs[propName] = {
            configurable: true,
            enumerable: true,
            get() {
                return this[$mobx].read(propName)
            },
            set(v) {
                this[$mobx].write(propName, v)
            }
        })
    )
}

function getAdministrationForComputedPropOwner(owner: any): ObservableObjectAdministration {
    const adm = owner[$mobx] // 获取 owner 的 observable object
    if (!adm) {
        // because computed props are declared on proty,
        // the current instance might not have been initialized yet
        initializeInstance(owner)
        return owner[$mobx]
    }
    return adm
}

// 直接从 target 取值会走到这里，也就是 target[name] 取值或者设置值
export function generateComputedPropConfig(propName) {
    return (
        computedPropertyConfigs[propName] ||
        (computedPropertyConfigs[propName] = {
            configurable: globalState.computedConfigurable,
            enumerable: false,
            get() {
                return getAdministrationForComputedPropOwner(this).read(propName)
            },
            set(v) {
                getAdministrationForComputedPropOwner(this).write(propName, v)
            }
        })
    )
}

const isObservableObjectAdministration = createInstanceofPredicate(
    "ObservableObjectAdministration",
    ObservableObjectAdministration
)

export function isObservableObject(thing: any): thing is IObservableObject {
    if (isObject(thing)) {
        // Initializers run lazily when transpiling to babel, so make sure they are run...
        initializeInstance(thing)
        // 判断 thing[$mobx] 是不是 ObservableObjectAdministration 的实例
        return isObservableObjectAdministration((thing as any)[$mobx])
    }
    return false
}
