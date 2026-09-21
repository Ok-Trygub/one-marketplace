import { setTimeout as sleep } from 'node:timers/promises'
import type { DataSource } from 'typeorm'

export type ClaimedJob = {
    id: string
    type: string
    payload: Record<string, unknown>
    attempts: number
}

export type JobHandler = (job: ClaimedJob) => Promise<void>

export type JobOutcome = 'done' | 'retry' | 'failed'

export type WorkerOptions = {
    queue?: string
    maxAttempts?: number
    idleDelayMs?: number
}

export type WorkerStats = {
    done: number
    retried: number
    failed: number
}

const DEFAULT_QUEUE = 'default'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_IDLE_DELAY_MS = 20

export const processNextJob = (
    dataSource: DataSource,
    workerName: string,
    handler: JobHandler,
    options: WorkerOptions = {},
): Promise<JobOutcome | null> => {
    const { queue = DEFAULT_QUEUE, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options

    return dataSource.transaction(async (manager) => {
        const jobs = await manager.query<ClaimedJob[]>(
            `SELECT id, type, payload, attempts
             FROM jobs
             WHERE status = 'pending' AND queue = $1
             ORDER BY id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [queue],
        )

        const job = jobs[0]

        if (!job) {
            return null
        }

        try {
            await handler(job)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)

            const [rows] = await manager.query<[{ status: string }[], number]>(
                `UPDATE jobs
                 SET attempts = attempts + 1,
                     last_error = $1,
                     worker = $2,
                     status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END
                 WHERE id = $4
                 RETURNING status`,
                [message, workerName, maxAttempts, job.id],
            )

            const outcome: JobOutcome = rows[0]?.status === 'failed' ? 'failed' : 'retry'

            console.warn(
                `${workerName}: job ${job.id} threw "${message}" on attempt ${job.attempts + 1}, ${outcome === 'failed' ? 'marked as failed' : 'left pending for another attempt'}`,
            )

            return outcome
        }

        await manager.query(
            `UPDATE jobs
             SET status = 'done',
                 processed = processed + 1,
                 attempts = attempts + 1,
                 worker = $1,
                 processed_at = now()
             WHERE id = $2`,
            [workerName, job.id],
        )

        return 'done'
    })
}

export const countPendingJobs = async (
    dataSource: DataSource,
    queue: string = DEFAULT_QUEUE,
): Promise<number> => {
    const [{ count }] = await dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM jobs WHERE status = 'pending' AND queue = $1`,
        [queue],
    )

    return count
}

export const runWorker = async (
    dataSource: DataSource,
    workerName: string,
    handler: JobHandler,
    options: WorkerOptions = {},
): Promise<WorkerStats> => {
    const { queue = DEFAULT_QUEUE, idleDelayMs = DEFAULT_IDLE_DELAY_MS } = options
    const stats: WorkerStats = { done: 0, retried: 0, failed: 0 }

    for (;;) {
        const outcome = await processNextJob(dataSource, workerName, handler, options)

        if (outcome === 'done') {
            stats.done += 1
            continue
        }

        if (outcome === 'retry') {
            stats.retried += 1
            continue
        }

        if (outcome === 'failed') {
            stats.failed += 1
            continue
        }

        if ((await countPendingJobs(dataSource, queue)) === 0) {
            return stats
        }

        await sleep(idleDelayMs)
    }
}
