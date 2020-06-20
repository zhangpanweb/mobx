import {
    BabelDescriptor,
    IEnhancer,
    asObservableObject,
    createPropDecorator,
    fail,
    invariant,
    stringifyKey
} from "../internal"

export type IObservableDecorator = {
    (target: Object, property: string | symbol, descriptor?: PropertyDescriptor): void
    enhancer: IEnhancer<any>
}

export function createDecoratorForEnhancer(enhancer: IEnhancer<any>): IObservableDecorator {
    invariant(enhancer)
    const decorator = createPropDecorator(
        true,
        (
            target: any,
            propertyName: PropertyKey,
            descriptor: BabelDescriptor | undefined,
            _decoratorTarget,
            decoratorArgs: any[]
        ) => {
            if (process.env.NODE_ENV !== "production") {
                // 有 descriptor.get 表示是 getter，报错，不能用于 getter
                invariant(
                    !descriptor || !descriptor.get,
                    `@observable cannot be used on getter (property "${stringifyKey(
                        propertyName
                    )}"), use @computed instead.`
                )
            }
            // 获取初始值
            const initialValue = descriptor
                ? descriptor.initializer
                    ? descriptor.initializer.call(target)
                    : descriptor.value
                : undefined
            asObservableObject(target).addObservableProp(propertyName, initialValue, enhancer)
        }
    )
    const res: any =
        // Extra process checks, as this happens during module initialization
        typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production"
            ? function observableDecorator() {
                  // This wrapper function is just to detect illegal decorator invocations, deprecate in a next version
                  // and simply return the created prop decorator
                  // 检测参数数量，然后还是应用 decorator
                  if (arguments.length < 2)
                      return fail(
                          "Incorrect decorator invocation. @observable decorator doesn't expect any arguments"
                      )
                  return decorator.apply(null, arguments)
              }
            : decorator
    // 挂载 enhancer
    res.enhancer = enhancer
    return res
}
