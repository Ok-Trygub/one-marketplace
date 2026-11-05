import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { StoredFile } from '../entities/stored-file.entity'
import { StorageService } from '../storage/storage.service'
import type { UploadedPart } from '../storage/storage.service'

export const UPLOAD_CONTENT_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/gzip': 'gz',
} as const

export type UploadContentType = keyof typeof UPLOAD_CONTENT_TYPES

const MIB = 1024 * 1024

export const UPLOAD_URL_TTL_SECONDS = 300

export const PART_URL_TTL_SECONDS = 900

export const PART_URLS_PER_BATCH = 100

export const MAX_UPLOAD_BYTES = 5 * 1024 * MIB

export const MIN_PART_BYTES = 5 * MIB

export const MAX_PARTS = 10_000

export const MULTIPART_THRESHOLD_BYTES = 2 * MIN_PART_BYTES

export const partSizeFor = (size: number): number =>
    Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS / MIB) * MIB)

export const partCountFor = (size: number): number => Math.ceil(size / partSizeFor(size))

export type SingleUploadPlan = {
    mode: 'single'
    url: string
    expiresIn: number
}

export type MultipartUploadPlan = {
    mode: 'multipart'
    partSize: number
    partCount: number
    uploaded: number[]
    parts: { partNumber: number; url: string }[]
    expiresIn: number
}

export type UploadPlan = SingleUploadPlan | MultipartUploadPlan

export type UploadErrorReason =
    | 'FILE_NOT_FOUND'
    | 'NOT_OWNER'
    | 'NOT_MULTIPART'
    | 'ALREADY_COMPLETED'
    | 'OBJECT_MISSING'
    | 'SIZE_MISMATCH'
    | 'PARTS_MISSING'

export class UploadError extends Error {
    override readonly name = 'UploadError'

    constructor(
        readonly reason: UploadErrorReason,
        message: string,
    ) {
        super(message)
    }
}

export const objectKeyFor = (ownerId: string, contentType: UploadContentType): string =>
    `uploads/${ownerId}/${randomUUID()}.${UPLOAD_CONTENT_TYPES[contentType]}`

const expectedPartSize = (size: number, partNumber: number): number => {
    const partSize = partSizeFor(size)

    return partNumber < partCountFor(size) ? partSize : size - partSize * (partCountFor(size) - 1)
}

@Injectable()
export class UploadsService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly storage: StorageService,
    ) {}

    async createIntent(
        ownerId: string,
        contentType: UploadContentType,
        size: number,
    ): Promise<{ file: StoredFile; plan: UploadPlan }> {
        const files = this.dataSource.getRepository(StoredFile)
        const key = objectKeyFor(ownerId, contentType)
        const multipart = size > MULTIPART_THRESHOLD_BYTES
        const uploadId = multipart ? await this.storage.createMultipart(key, contentType) : null
        const file = await files.save(files.create({ key, ownerId, contentType, size: String(size), uploadId }))

        if (!uploadId) {
            const url = await this.storage.presignPut(key, contentType, UPLOAD_URL_TTL_SECONDS)

            return { file, plan: { mode: 'single', url, expiresIn: UPLOAD_URL_TTL_SECONDS } }
        }

        return { file, plan: await this.multipartPlan(file, uploadId, []) }
    }

    async resume(ownerId: string, fileId: string): Promise<{ file: StoredFile; plan: MultipartUploadPlan }> {
        const file = await this.load(ownerId, fileId)

        if (file.status === 'COMPLETED') {
            throw new UploadError('ALREADY_COMPLETED', `File '${fileId}' is already completed`)
        }

        if (!file.uploadId) {
            throw new UploadError('NOT_MULTIPART', `File '${fileId}' is uploaded with a single PUT`)
        }

        const uploaded = await this.storage.listParts(file.key, file.uploadId)

        return { file, plan: await this.multipartPlan(file, file.uploadId, uploaded) }
    }

    async commit(ownerId: string, fileId: string): Promise<StoredFile> {
        const file = await this.load(ownerId, fileId)

        if (file.status === 'COMPLETED') {
            return file
        }

        if (file.uploadId) {
            await this.completeMultipart(file, file.uploadId)
        }

        const object = await this.storage.head(file.key)

        if (!object) {
            throw new UploadError('OBJECT_MISSING', `File '${fileId}' has no uploaded bytes yet`)
        }

        if (String(object.size) !== file.size) {
            throw new UploadError(
                'SIZE_MISMATCH',
                `File '${fileId}' was declared as ${file.size} bytes, the storage holds ${object.size}`,
            )
        }

        const files = this.dataSource.getRepository(StoredFile)

        await files
            .createQueryBuilder()
            .update()
            .set({ status: 'COMPLETED', completedAt: () => 'now()' })
            .where('id = :id', { id: file.id })
            .andWhere("status = 'PENDING'")
            .execute()

        return files.findOneByOrFail({ id: file.id })
    }

    private async load(ownerId: string, fileId: string): Promise<StoredFile> {
        const file = await this.dataSource.getRepository(StoredFile).findOneBy({ id: fileId })

        if (!file) {
            throw new UploadError('FILE_NOT_FOUND', `File '${fileId}' was not found`)
        }

        if (file.ownerId !== ownerId) {
            throw new UploadError('NOT_OWNER', `File '${fileId}' belongs to another user`)
        }

        return file
    }

    private async multipartPlan(
        file: StoredFile,
        uploadId: string,
        uploaded: UploadedPart[],
    ): Promise<MultipartUploadPlan> {
        const size = Number(file.size)
        const partCount = partCountFor(size)
        const done = new Set(
            uploaded
                .filter((part) => part.size === expectedPartSize(size, part.partNumber))
                .map((part) => part.partNumber),
        )
        const missing = Array.from({ length: partCount }, (_, index) => index + 1)
            .filter((partNumber) => !done.has(partNumber))
            .slice(0, PART_URLS_PER_BATCH)
        const parts = await Promise.all(
            missing.map(async (partNumber) => ({
                partNumber,
                url: await this.storage.presignPart(file.key, uploadId, partNumber, PART_URL_TTL_SECONDS),
            })),
        )

        return {
            mode: 'multipart',
            partSize: partSizeFor(size),
            partCount,
            uploaded: [...done].sort((left, right) => left - right),
            parts,
            expiresIn: PART_URL_TTL_SECONDS,
        }
    }

    private async completeMultipart(file: StoredFile, uploadId: string): Promise<void> {
        const uploaded = await this.storage.listParts(file.key, uploadId).catch((error: unknown) => {
            if (this.storage.isNotFound(error)) {
                return null
            }

            throw error
        })

        if (!uploaded) {
            return
        }

        const size = Number(file.size)
        const partCount = partCountFor(size)
        const valid = uploaded.filter(
            (part) => part.partNumber <= partCount && part.size === expectedPartSize(size, part.partNumber),
        )

        if (valid.length !== partCount) {
            throw new UploadError(
                'PARTS_MISSING',
                `File '${file.id}' has ${valid.length} of ${partCount} parts with the expected size`,
            )
        }

        await this.storage.completeMultipart(file.key, uploadId, valid)
    }
}