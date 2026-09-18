import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { Job } from './entities/job.entity'
import { runWorker } from './services/job-worker.service'

const WORKERS = 4
const NEW_JOBS = 20
const JOB_DURATION_MS = 100

const main = async () => {
    await AppDataSource.initialize()

    try {
        await AppDataSource.getRepository(Job).insert(
            Array.from({ length: NEW_JOBS }, (_, index) => ({
                type: 'send_receipt',
                payload: { demo: true, number: index + 1 },
            })),
        )

        const pending = await AppDataSource.query<{ id: string }[]>(
            `SELECT id FROM jobs WHERE status = 'pending' ORDER BY id`,
        )
        const ids = pending.map((job) => job.id)

        const startedAt = performance.now()

        await Promise.all(
            Array.from({ length: WORKERS }, (_, index) =>
                runWorker(AppDataSource, `worker-${index + 1}`, () => sleep(JOB_DURATION_MS)),
            ),
        )

        const elapsedMs = Math.round(performance.now() - startedAt)
        const sequentialMs = ids.length * JOB_DURATION_MS

        const distribution = await AppDataSource.query<{ worker: string; count: number }[]>(
            `SELECT worker, count(*)::int AS count
             FROM jobs
             WHERE id = ANY($1::bigint[])
             GROUP BY worker
             ORDER BY worker`,
            [ids],
        )

        const [{ count: processedTwice }] = await AppDataSource.query<{ count: number }[]>(
            `SELECT count(*)::int AS count FROM jobs WHERE processed > 1`,
        )

        const [{ count: unprocessed }] = await AppDataSource.query<{ count: number }[]>(
            `SELECT count(*)::int AS count
             FROM jobs
             WHERE id = ANY($1::bigint[]) AND (status <> 'done' OR processed <> 1)`,
            [ids],
        )

        const processedTotal = distribution.reduce((sum, row) => sum + row.count, 0)

        console.log(`jobs in queue: ${ids.length}`)
        console.log(`workers: ${WORKERS}`)
        console.log(`distribution: ${distribution.map((row) => `${row.worker}: ${row.count}`).join(', ')}`)
        console.log(`processed: ${processedTotal}`)
        console.log(`processed twice: ${processedTwice}`)
        console.log(`оброблено двічі: ${processedTwice}`)
        console.log(`not processed: ${unprocessed}`)
        console.log(`total time: ${elapsedMs} ms`)
        console.log(`sequential would be: ${sequentialMs} ms, ${ids.length} jobs x ${JOB_DURATION_MS} ms`)

        const invariantHolds =
            processedTwice === 0 &&
            unprocessed === 0 &&
            processedTotal === ids.length &&
            distribution.length >= 2 &&
            elapsedMs < sequentialMs

        if (!invariantHolds) {
            console.error('INVARIANT VIOLATED: double processing, skipped jobs or no speedup')
            process.exitCode = 1

            return
        }

        console.log('invariant holds: every job processed exactly once')
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})