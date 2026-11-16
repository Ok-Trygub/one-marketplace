import {
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import { CurrentUser } from '../auth/current-user.decorator'
import type { StoredFile } from '../entities/stored-file.entity'
import { UploadError, UploadsService } from '../services/uploads.service'
import type { MultipartUploadPlan, UploadContentType, UploadPlan } from '../services/uploads.service'

export type UploadIntentBody = {
    filename: string
    content_type: UploadContentType
    size: number
}

export type UploadCommitBody = {
    file_id: string
}

export type FileResponse = {
    file_id: string
    key: string
    status: string
    content_type: string
    size: number
    created_at: string
    completed_at: string | null
}

export type SingleUploadResponse = {
    mode: 'single'
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expires_in: number
}

export type MultipartUploadResponse = {
    mode: 'multipart'
    part_size: number
    part_count: number
    uploaded: number[]
    parts: { part_number: number; method: 'PUT'; url: string }[]
    expires_in: number
}

export type UploadIntentResponse = FileResponse & {
    upload: SingleUploadResponse | MultipartUploadResponse
}

const toFileResponse = (file: StoredFile): FileResponse => ({
    file_id: file.id,
    key: file.key,
    status: file.status,
    content_type: file.contentType,
    size: Number(file.size),
    created_at: file.createdAt.toISOString(),
    completed_at: file.completedAt?.toISOString() ?? null,
})

const toMultipartResponse = (plan: MultipartUploadPlan): MultipartUploadResponse => ({
    mode: 'multipart',
    part_size: plan.partSize,
    part_count: plan.partCount,
    uploaded: plan.uploaded,
    parts: plan.parts.map((part) => ({ part_number: part.partNumber, method: 'PUT', url: part.url })),
    expires_in: plan.expiresIn,
})

const toUploadResponse = (file: StoredFile, plan: UploadPlan): SingleUploadResponse | MultipartUploadResponse =>
    plan.mode === 'single'
        ? {
            mode: 'single',
            method: 'PUT',
            url: plan.url,
            headers: { 'Content-Type': file.contentType },
            expires_in: plan.expiresIn,
        }
        : toMultipartResponse(plan)

const translateUploadError = (error: unknown): never => {
    if (error instanceof UploadError) {
        if (error.reason === 'FILE_NOT_FOUND') {
            throw new NotFoundException(error.message)
        }

        if (error.reason === 'NOT_OWNER') {
            throw new ForbiddenException(error.message)
        }

        throw new ConflictException(error.message)
    }

    throw error
}

@Controller('uploads')
@UseGuards(AuthGuard)
export class UploadsController {
    constructor(private readonly uploads: UploadsService) {}

    @Post('intent')
    @HttpCode(200)
    async intent(@CurrentUser() user: AuthenticatedUser, @Body() body: UploadIntentBody): Promise<UploadIntentResponse> {
        const { file, plan } = await this.uploads.createIntent(user.id, body.content_type, body.size)

        return { ...toFileResponse(file), upload: toUploadResponse(file, plan) }
    }

    @Get(':id/parts')
    async parts(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<UploadIntentResponse> {
        const { file, plan } = await this.uploads.resume(user.id, id).catch(translateUploadError)

        return { ...toFileResponse(file), upload: toMultipartResponse(plan) }
    }

    @Post('commit')
    @HttpCode(200)
    async commit(@CurrentUser() user: AuthenticatedUser, @Body() body: UploadCommitBody): Promise<FileResponse> {
        const file = await this.uploads.commit(user.id, body.file_id).catch(translateUploadError)

        return toFileResponse(file)
    }
}