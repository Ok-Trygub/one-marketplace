import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContext = {
    userId?: string
    tenant?: string
    idempotencyKey?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

export const setRequestContext = (values: RequestContext): void => {
    const store = requestContext.getStore()

    if (store) {
        Object.assign(store, values)
    }
}
