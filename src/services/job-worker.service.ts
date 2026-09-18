import { setTimeout as sleep } from 'node:timers/promises'
import type { DataSource } from 'typeorm'

export type ClaimedJob = {
    id: string
    type: string
    payload: Record<string, unknown>
}

export type JobHandler = (job: ClaimedJob) => Promise<void>

export const processNextJob = (
    dataSource: DataSource,
    workerName: string,
    handler: JobHandler,
): Promise<ClaimedJob | null> =>
    dataSource.transaction(async (manager) => {
        const jobs = await manager.query<ClaimedJob[]>(
            `SELECT id, type, payload
             FROM jobs
             WHERE status = 'pending'
             ORDER BY id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
        )

        const job = jobs[0]

        if (!job) {
            return null
        }

        await handler(job)

        await manager.query(
            `UPDATE jobs
             SET status = 'done',
                 processed = processed + 1,
                 worker = $1,
                 processed_at = now()
             WHERE id = $2`,
            [workerName, job.id],
        )

        return job
    })

export const countPendingJobs = async (dataSource: DataSource): Promise<number> => {
    const [{ count }] = await dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM jobs WHERE status = 'pending'`,
    )

    return count
}

export const runWorker = async (
    dataSource: DataSource,
    workerName: string,
    handler: JobHandler,
    idleDelayMs = 20,
): Promise<number> => {
    let processed = 0

    for (;;) {
        const job = await processNextJob(dataSource, workerName, handler)

        if (job) {
            processed += 1
            continue
        }

        if ((await countPendingJobs(dataSource)) === 0) {
            return processed
        }

        await sleep(idleDelayMs)
    }
}