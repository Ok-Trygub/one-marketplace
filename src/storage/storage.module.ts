import { Inject, Module } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { S3Client } from '@aws-sdk/client-s3'
import type { Env } from '../config/env.schema'
import { STORAGE_BUCKET, STORAGE_CLIENT, createStorageClient } from './storage-client'
import { StorageService } from './storage.service'

class StorageLifecycle implements OnModuleDestroy {
    constructor(@Inject(STORAGE_CLIENT) private readonly client: S3Client) {}

    onModuleDestroy(): void {
        this.client.destroy()
    }
}

@Module({
    providers: [
        {
            provide: STORAGE_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) =>
                createStorageClient({
                    endpoint: config.get('STORAGE_ENDPOINT', { infer: true }),
                    region: config.get('STORAGE_REGION', { infer: true }),
                    accessKeyId: config.get('STORAGE_ACCESS_KEY', { infer: true }),
                    secretAccessKey: config.get('STORAGE_SECRET_KEY', { infer: true }),
                }),
        },
        {
            provide: STORAGE_BUCKET,
            inject: [ConfigService],
            useFactory: (config: ConfigService<Env, true>) => config.get('STORAGE_BUCKET', { infer: true }),
        },
        StorageLifecycle,
        StorageService,
    ],
    exports: [StorageService],
})
export class StorageModule {}