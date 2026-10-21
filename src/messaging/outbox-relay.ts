import type { DataSource } from 'typeorm'
import type { OrderPlacedPublisher } from './order-placed.publisher'
import type { OrderPlacedEvent } from './order-placed.event'

export const RELAY_BATCH_SIZE = 100

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

export const relayBatch = (
    dataSource: DataSource,
    publisher: OrderPlacedPublisher,
    options: RelayOptions = {},
): Promise<number> => {
    const { limit = RELAY_BATCH_SIZE, afterPublish } = options

    return dataSource.transaction(async (manager) => {
        const rows = await manager.query<OutboxRow[]>(
            `SELECT id, aggregate_type, aggregate_id, type, payload
             FROM outbox
             WHERE published_at IS NULL
             ORDER BY created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $1`,
            [limit],
        )

        let published = 0

        for (const row of rows) {
            try {
                await publisher.publish(row.payload, row.id)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)

                await manager.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id])
                console.warn(`relay: outbox ${row.id} was not published: ${message}`)

                break
            }

            await afterPublish?.(row)

            await manager.query(
                `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
                [row.id],
            )

            published += 1
        }

        return published
    })
}