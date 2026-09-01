import { createHash } from 'node:crypto'

type IdempotencyRecord<T> = {
    fingerprint: string
    response: T
    statusCode: number
}

const records = new Map<string, IdempotencyRecord<unknown>>()

const canonicalize = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`
    }

    if (value !== null && typeof value === 'object') {
        const object = value as Record<string, unknown>

        return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
            .join(',')}}`
    }

    return JSON.stringify(value)
}

export const createFingerprint = (value: unknown): string => {
    const canonicalJson = canonicalize(value)

    return createHash('sha256')
        .update(canonicalJson)
        .digest('hex')
}

export const getIdempotencyRecord = <T>(
    key: string,
): IdempotencyRecord<T> | undefined => {
    return records.get(key) as IdempotencyRecord<T> | undefined
}

export const saveIdempotencyRecord = <T>(
    key: string,
    requestBody: unknown,
    response: T,
    statusCode: number,
): void => {
    records.set(key, {
        fingerprint: createFingerprint(requestBody),
        response,
        statusCode,
    })
}

type IdempotencyResult<T> = {
    response: T
    statusCode: number
    replay: boolean
}

export const handleIdempotency = <T>(
    key: string,
    requestBody: unknown,
    createResource: () => T,
): IdempotencyResult<T> => {
    const existingRecord = getIdempotencyRecord<T>(key)

    if (existingRecord) {
        const fingerprint = createFingerprint(requestBody)

        if (existingRecord.fingerprint !== fingerprint) {
            const error = new Error(
                'Idempotency-Key was already used with a different request body',
            ) as Error & { status: number }

            error.status = 422

            throw error
        }

        return {
            response: existingRecord.response,
            statusCode: existingRecord.statusCode,
            replay: true,
        }
    }

    const resource = createResource()

    saveIdempotencyRecord(
        key,
        requestBody,
        resource,
        201,
    )

    return {
        response: resource,
        statusCode: 201,
        replay: false,
    }
}