import { S3Client } from '@aws-sdk/client-s3'

export type StorageConnection = {
    endpoint?: string
    region: string
    accessKeyId: string
    secretAccessKey: string
}

export const STORAGE_CLIENT = 'STORAGE_CLIENT'

export const STORAGE_BUCKET = 'STORAGE_BUCKET'

export const createStorageClient = ({ endpoint, region, accessKeyId, secretAccessKey }: StorageConnection): S3Client =>
    new S3Client({
        region,
        endpoint,
        forcePathStyle: Boolean(endpoint),
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    })

const required = (name: string): string => {
    const value = process.env[name]

    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

export const storageConnectionFromEnv = (): StorageConnection => ({
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    region: process.env.STORAGE_REGION || 'us-east-1',
    accessKeyId: required('STORAGE_ACCESS_KEY'),
    secretAccessKey: required('STORAGE_SECRET_KEY'),
})

export const storageBucketFromEnv = (): string => required('STORAGE_BUCKET')