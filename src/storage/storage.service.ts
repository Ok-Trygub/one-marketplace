import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateBucketCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListMultipartUploadsCommand,
    ListObjectsV2Command,
    ListPartsCommand,
    PutBucketLifecycleConfigurationCommand,
    PutObjectCommand,
    S3Client,
    S3ServiceException,
    UploadPartCommand,
} from '@aws-sdk/client-s3'
import type { BucketLocationConstraint } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Inject, Injectable } from '@nestjs/common'
import { STORAGE_BUCKET, STORAGE_CLIENT } from './storage-client'

export type StoredObject = {
    size: number
    etag: string
    contentType: string | undefined
    cacheControl: string | undefined
}

export type FetchedObject = StoredObject & {
    body: Buffer
}

export type UploadedPart = {
    partNumber: number
    etag: string
    size: number
}

export type PendingMultipart = {
    key: string
    uploadId: string
}

export const INCOMPLETE_MULTIPART_TTL_DAYS = 7

const statusOf = (error: unknown): number | undefined =>
    error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined

@Injectable()
export class StorageService {
    constructor(
        @Inject(STORAGE_CLIENT) private readonly client: S3Client,
        @Inject(STORAGE_BUCKET) readonly bucket: string,
    ) {}

    isNotFound(error: unknown): boolean {
        return statusOf(error) === 404
    }

    async ensureBucket(): Promise<'created' | 'exists'> {
        const outcome = await this.client
            .send(new HeadBucketCommand({ Bucket: this.bucket }))
            .then(() => 'exists' as const)
            .catch(async (error: unknown) => {
                if (statusOf(error) !== 404) {
                    throw error
                }

                const region = await this.client.config.region()

                await this.client.send(
                    new CreateBucketCommand({
                        Bucket: this.bucket,
                        CreateBucketConfiguration:
                            region === 'us-east-1' ? undefined : { LocationConstraint: region as BucketLocationConstraint },
                    }),
                )

                return 'created' as const
            })

        await this.client
            .send(
                new PutBucketLifecycleConfigurationCommand({
                    Bucket: this.bucket,
                    LifecycleConfiguration: {
                        Rules: [
                            {
                                ID: 'abort-incomplete-multipart',
                                Status: 'Enabled',
                                Filter: { Prefix: '' },
                                AbortIncompleteMultipartUpload: { DaysAfterInitiation: INCOMPLETE_MULTIPART_TTL_DAYS },
                            },
                        ],
                    },
                }),
            )
            .catch((error: unknown) => {
                if (statusOf(error) !== 501) {
                    throw error
                }

                console.warn(
                    `storage: bucket ${this.bucket} does not support lifecycle rules, incomplete multipart uploads are not aborted automatically`,
                )
            })

        return outcome
    }

    presignPut(key: string, contentType: string, expiresIn: number): Promise<string> {
        return getSignedUrl(
            this.client,
            new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
            { expiresIn, signableHeaders: new Set(['content-type']) },
        )
    }

    presignGet(key: string, expiresIn: number): Promise<string> {
        return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn })
    }

    async head(key: string): Promise<StoredObject | null> {
        try {
            const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))

            return {
                size: object.ContentLength ?? 0,
                etag: object.ETag ?? '',
                contentType: object.ContentType,
                cacheControl: object.CacheControl,
            }
        } catch (error) {
            if (statusOf(error) === 404) {
                return null
            }

            throw error
        }
    }

    async getObject(key: string): Promise<FetchedObject | null> {
        try {
            const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
            const body = Buffer.from((await object.Body?.transformToByteArray()) ?? [])

            return {
                body,
                size: body.length,
                etag: object.ETag ?? '',
                contentType: object.ContentType,
                cacheControl: object.CacheControl,
            }
        } catch (error) {
            if (statusOf(error) === 404) {
                return null
            }

            throw error
        }
    }

    async putObject(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: cacheControl,
            }),
        )
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    }

    async createMultipart(key: string, contentType: string): Promise<string> {
        const { UploadId } = await this.client.send(
            new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
        )

        if (!UploadId) {
            throw new Error(`storage did not return an upload id for ${key}`)
        }

        return UploadId
    }

    presignPart(key: string, uploadId: string, partNumber: number, expiresIn: number): Promise<string> {
        return getSignedUrl(
            this.client,
            new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
            { expiresIn },
        )
    }

    async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
        const parts: UploadedPart[] = []
        let marker: string | undefined

        do {
            const page = await this.client.send(
                new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
            )

            for (const part of page.Parts ?? []) {
                parts.push({ partNumber: part.PartNumber ?? 0, etag: part.ETag ?? '', size: part.Size ?? 0 })
            }

            marker = page.IsTruncated ? page.NextPartNumberMarker : undefined
        } while (marker)

        return parts
    }

    async completeMultipart(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
        await this.client.send(
            new CompleteMultipartUploadCommand({
                Bucket: this.bucket,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: {
                    Parts: [...parts]
                        .sort((left, right) => left.partNumber - right.partNumber)
                        .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
                },
            }),
        )
    }

    async listMultipartUploads(prefix: string): Promise<PendingMultipart[]> {
        const uploads: PendingMultipart[] = []
        let keyMarker: string | undefined
        let uploadIdMarker: string | undefined

        do {
            const page = await this.client.send(
                new ListMultipartUploadsCommand({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    KeyMarker: keyMarker,
                    UploadIdMarker: uploadIdMarker,
                }),
            )

            for (const upload of page.Uploads ?? []) {
                if (upload.Key && upload.UploadId) {
                    uploads.push({ key: upload.Key, uploadId: upload.UploadId })
                }
            }

            keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined
            uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined
        } while (keyMarker)

        return uploads
    }

    async listKeys(prefix: string): Promise<string[]> {
        const keys: string[] = []
        let token: string | undefined

        do {
            const page = await this.client.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
            )

            keys.push(...(page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])))
            token = page.IsTruncated ? page.NextContinuationToken : undefined
        } while (token)

        return keys
    }

    async abortMultipart(key: string, uploadId: string): Promise<void> {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
    }
}