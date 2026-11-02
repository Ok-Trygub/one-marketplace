import type { DataSource } from 'typeorm'
import { Outbox } from '../entities/outbox.entity'

export const OUTBOX_RETENTION_DAYS = 7

export const OUTBOX_CLEANUP_BATCH = 1000

export const cleanupOutbox = async (
    dataSource: DataSource,
    retentionDays: number = OUTBOX_RETENTION_DAYS,
    batchSize: number = OUTBOX_CLEANUP_BATCH,
): Promise<number> => {
    let deleted = 0

    while (true) {
        const result = await dataSource
            .createQueryBuilder()
            .delete()
            .from(Outbox)
            .where(
                `id IN (SELECT id FROM outbox WHERE published_at < now() - make_interval(days => :days) LIMIT :limit)`,
                { days: retentionDays, limit: batchSize },
            )
            .execute()
        const affected = result.affected ?? 0

        deleted += affected

        if (affected < batchSize) {
            return deleted
        }
    }
}
