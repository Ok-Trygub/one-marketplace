import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { DataSource } from 'typeorm'

@Controller('health')
export class HealthController {
    constructor(private readonly dataSource: DataSource) {}

    @Get()
    async check(@Res() response: Response): Promise<void> {
        try {
            const [{ ok }] = await this.dataSource.query<{ ok: number }[]>('SELECT 1 AS ok')

            response.status(200).json({ status: 'ok', database: ok === 1, uptime: process.uptime() })
        } catch (error) {
            console.error('Health check failed:', error)

            response.status(503).json({ status: 'error', database: false })
        }
    }
}
