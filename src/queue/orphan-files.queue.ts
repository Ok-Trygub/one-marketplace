import { Queue, Worker } from 'bullmq'
import type { Job, Processor } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DataSource } from 'typeorm'
import { cleanupOrphanFiles } from '../storage/orphan-files'
import type { StorageService } from '../storage/storage.service'

export const ORPHAN_FILES_QUEUE = 'orphan-files'
export const CLEANUP_ORPHANS_JOB = 'cleanup-orphans'
export const CLEANUP_ORPHANS_SCHEDULER = 'orphan-files-cleanup'

export const createOrphanFilesQueue = (connection: Redis): Queue =>
    new Queue(ORPHAN_FILES_QUEUE, {
        connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
            removeOnComplete: { age: 24 * 3600 },
            removeOnFail: { age: 7 * 24 * 3600 },
        },
    })

export const upsertOrphanCleanupScheduler = (queue: Queue, everyMs: number): Promise<Job> =>
    queue.upsertJobScheduler(CLEANUP_ORPHANS_SCHEDULER, { every: everyMs }, { name: CLEANUP_ORPHANS_JOB, data: {} })

export const createOrphanCleanupProcessor = (dataSource: DataSource, storage: StorageService): Processor =>
    async () => {
        const removed = await cleanupOrphanFiles(dataSource, storage)

        if (removed > 0) {
            console.log(`orphan-files: removed ${removed} PENDING files older than a day`)
        }

        return { removed }
    }

export const createOrphanFilesWorker = (connection: Redis, processor: Processor): Worker =>
    new Worker(ORPHAN_FILES_QUEUE, processor, { connection })