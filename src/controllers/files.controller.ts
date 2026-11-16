import {
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    Redirect,
    Res,
    UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedUser } from '../auth/authenticated-user'
import { CurrentUser } from '../auth/current-user.decorator'
import { UploadError, UploadsService } from '../services/uploads.service'

const translateDownloadError = (error: unknown): never => {
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

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
    constructor(private readonly uploads: UploadsService) {}

    @Get(':id')
    @Redirect()
    async download(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') id: string,
        @Res({ passthrough: true }) response: Response,
    ): Promise<{ url: string; statusCode: number }> {
        const url = await this.uploads.downloadUrl(user.id, id).catch(translateDownloadError)

        response.set('Cache-Control', 'no-store')

        return { url, statusCode: 302 }
    }
}
