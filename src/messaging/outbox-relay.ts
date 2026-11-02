import type { DataSource } from 'typeorm'
import { UnroutableEventError } from './order-placed.publisher'
import type { OrderPlacedPublisher } from './order-placed.publisher'
import type { OrderPlacedEvent } from './order-placed.event'

export const RELAY_BATCH_SIZE = 100

export const RELAY_MAX_ATTEMPTS = 10

export type OutboxRow = {
    id: string
    aggregate_type: string
    aggregate_id: string
    type: string
    payload: OrderPlacedEvent
}

export type RelayOptions = {
    limit?: number
    afterPublish?: (row: OutboxRow) => Promise<void> | void
}

type RelayOutcome = 'published' | 'failed' | 'empty'

export const relayBatch = async (
    dataSource: DataSource,
    publisher: OrderPlacedPublisher,
    options: RelayOptions = {},
): Promise<number> => {
    const { limit = RELAY_BATCH_SIZE, afterPublish } = options
    const failed: string[] = []
    let published = 0

    for (let index = 0; index < limit; index += 1) {
        const outcome = await dataSource.transaction(async (manager): Promise<RelayOutcome> => {
            const [row] = await manager.query<OutboxRow[]>(
                `SELECT id, aggregate_type, aggregate_id, type, payload
                 FROM outbox
                 WHERE published_at IS NULL
                   AND attempts < $1
                   AND id <> ALL($2::uuid[])
                 ORDER BY created_at, id
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`,
                [RELAY_MAX_ATTEMPTS, failed],
            )

            if (!row) {
                return 'empty'
            }

            try {
                await publisher.publish(row.payload, row.id)
            } catch (error) {
                if (!(error instanceof UnroutableEventError)) {
                    throw error
                }

                await manager.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id])
                console.warn(`relay: outbox ${row.id} was not published: ${error.message}`)
                failed.push(row.id)

                return 'failed'
            }

            await afterPublish?.(row)

            await manager.query(
                `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
                [row.id],
            )

            return 'published'
        })

        if (outcome === 'empty') {
            break
        }

        if (outcome === 'published') {
            published += 1
        }
    }

    return published
}
