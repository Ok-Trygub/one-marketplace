import type { DataSource } from 'typeorm'
import type { StorageService } from './storage.service'

export const ORPHAN_AGE_SECONDS = 24 * 60 * 60

export const ORPHAN_BATCH = 100

type OrphanRow = {
    id: string
    key: string
    upload_id: string | null
}

export const cleanupOrphanFiles = async (
    dataSource: DataSource,
    storage: StorageService,
    olderThanSeconds: number = ORPHAN_AGE_SECONDS,
    batchSize: number = ORPHAN_BATCH,
): Promise<number> => {
    let removed = 0

    while (true) {
        const batch = await dataSource.transaction(async (manager) => {
            const rows = await manager.query<OrphanRow[]>(
                `SELECT id, key, upload_id
                 FROM files
                 WHERE status = 'PENDING'
                   AND created_at < now() - make_interval(secs => $1)
                 ORDER BY created_at
                 LIMIT $2
                 FOR UPDATE SKIP LOCKED`,
                [olderThanSeconds, batchSize],
            )

            for (const row of rows) {
                if (row.upload_id) {
                    await storage.abortMultipart(row.key, row.upload_id).catch((error: unknown) => {
                        if (!storage.isNotFound(error)) {
                            throw error
                        }
                    })
                }

                await storage.deleteObject(row.key)
                await manager.query(`DELETE FROM files WHERE id = $1 AND status = 'PENDING'`, [row.id])
            }

            return rows.length
        })

        removed += batch

        if (batch < batchSize) {
            return removed
        }
    }
}