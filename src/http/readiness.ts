import { Injectable } from '@nestjs/common'

@Injectable()
export class Readiness {
    private ready = false

    markReady(): void {
        this.ready = true
    }

    startDraining(): void {
        this.ready = false
    }

    isReady(): boolean {
        return this.ready
    }
}
