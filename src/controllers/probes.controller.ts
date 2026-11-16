import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { Readiness } from '../http/readiness'

@Controller()
export class ProbesController {
    constructor(private readonly readiness: Readiness) {}

    @Get('healthz')
    alive(@Res() response: Response): void {
        response.status(200).json({ status: 'alive' })
    }

    @Get('readyz')
    ready(@Res() response: Response): void {
        const ready = this.readiness.isReady()

        response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' })
    }
}
