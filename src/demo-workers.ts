import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { Job } from './entities/job.entity'
import { runWorker } from './services/job-worker.service'
import type { JobHandler } from './services/job-worker.service'

const WORKERS = 4
const REGULAR_JOBS = 20
const POISON_JOBS = 1
const MAX_ATTEMPTS = 3
const JOB_DURATION_MS = 100

type DemoJob = {
    queue: string
    type: string
    payload: { number?: number; poison?: boolean }
}

const handler: JobHandler = async (job) => {
    if (job.payload.poison === true) {
        throw new Error('poison job')
    }

    await sleep(JOB_DURATION_MS)
}

const count = async (sql: string, parameters: unknown[]): Promise<number> => {
    const [row] = await AppDataSource.query<{ count: number }[]>(sql, parameters)

    return row.count
}

const main = async () => {
    await AppDataSource.initialize()

    try {
        const queue = `demo-workers-${randomUUID()}`
        const poisonPosition = Math.floor(REGULAR_JOBS / 2)

        const jobs: DemoJob[] = Array.from({ length: REGULAR_JOBS }, (_, index) => ({
            queue,
            type: 'send_receipt',
            payload: { number: index + 1 },
        }))

        jobs.splice(poisonPosition, 0, {
            queue,
            type: 'send_receipt',
            payload: { poison: true },
        })

        await AppDataSource.getRepository(Job).insert(jobs)

        const startedAt = performance.now()

        await Promise.all(
            Array.from({ length: WORKERS }, (_, index) =>
                runWorker(AppDataSource, `worker-${index + 1}`, handler, {
                    queue,
                    maxAttempts: MAX_ATTEMPTS,
                }),
            ),
        )

        const elapsedMs = Math.round(performance.now() - startedAt)
        const sequentialMs = REGULAR_JOBS * JOB_DURATION_MS

        const distribution = await AppDataSource.query<{ worker: string; count: number }[]>(
            `SELECT worker, count(*)::int AS count
             FROM jobs
             WHERE queue = $1 AND status = 'done'
             GROUP BY worker
             ORDER BY worker`,
            [queue],
        )

        const total = await count(
            `SELECT count(*)::int AS count FROM jobs WHERE queue = $1`,
            [queue],
        )
        const processedOnce = await count(
            `SELECT count(*)::int AS count FROM jobs WHERE queue = $1 AND status = 'done' AND processed = 1`,
            [queue],
        )
        const processedTwice = await count(
            `SELECT count(*)::int AS count FROM jobs WHERE queue = $1 AND processed > 1`,
            [queue],
        )
        const failed = await count(
            `SELECT count(*)::int AS count
             FROM jobs
             WHERE queue = $1 AND status = 'failed' AND processed = 0 AND attempts = $2`,
            [queue, MAX_ATTEMPTS],
        )
        const stillPending = await count(
            `SELECT count(*)::int AS count FROM jobs WHERE queue = $1 AND status = 'pending'`,
            [queue],
        )

        console.log(`queue: ${queue}`)
        console.log(`jobs in queue: ${total}, ${REGULAR_JOBS} regular and ${POISON_JOBS} poison`)
        console.log(`workers: ${WORKERS}`)
        console.log(`distribution: ${distribution.map((row) => `${row.worker}: ${row.count}`).join(', ')}`)
        console.log(`processed exactly once: ${processedOnce}`)
        console.log(`processed twice: ${processedTwice}`)
        console.log(`оброблено двічі: ${processedTwice}`)
        console.log(`failed after ${MAX_ATTEMPTS} attempts: ${failed}`)
        console.log(`still pending: ${stillPending}`)
        console.log(`total time: ${elapsedMs} ms`)
        console.log(`sequential would be: ${sequentialMs} ms, ${REGULAR_JOBS} jobs x ${JOB_DURATION_MS} ms`)

        const invariantHolds =
            total === REGULAR_JOBS + POISON_JOBS &&
            processedOnce === REGULAR_JOBS &&
            processedTwice === 0 &&
            failed === POISON_JOBS &&
            stillPending === 0 &&
            distribution.length >= 2 &&
            elapsedMs < sequentialMs

        if (!invariantHolds) {
            console.error('INVARIANT VIOLATED: double processing, skipped jobs, a worker died or no speedup')
            process.exitCode = 1

            return
        }

        console.log('invariant holds: every regular job processed exactly once, the poison job isolated')
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
