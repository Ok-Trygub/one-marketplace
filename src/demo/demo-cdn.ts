import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { publishAsset } from '../storage/assets'
import { finish, runDemo } from './auth-demo-support'
import { freePort, isPortAlive, removePrefix, standaloneStorage } from './files-demo-support'

const ASSET_NAME = 'demo-app'
const EDGE = path.join(__dirname, '..', 'edge.js')

const originUrl = (bucket: string, key: string): string => {
    const endpoint = process.env.STORAGE_ENDPOINT

    return endpoint
        ? `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
        : `https://${bucket}.s3.${process.env.STORAGE_REGION || 'us-east-1'}.amazonaws.com/${key}`
}

const startEdge = async (port: number): Promise<ChildProcess> => {
    const edge = spawn(process.execPath, [EDGE], { env: { ...process.env, EDGE_PORT: String(port) }, stdio: 'ignore' })

    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await isPortAlive(port)) {
            return edge
        }

        await sleep(100)
    }

    edge.kill()
    throw new Error(`edge did not start on port ${port}`)
}

const main = async (): Promise<number> => {
    const storage = standaloneStorage()
    const port = await freePort()
    const edgeUrl = `http://127.0.0.1:${port}`

    await storage.ensureBucket()
    await removePrefix(storage, `assets/${ASSET_NAME}.`)

    const edge = await startEdge(port)

    try {
        const first = Buffer.from('body{color:red}')
        const second = Buffer.from('body{color:blue}')

        const firstKey = await publishAsset(storage, ASSET_NAME, 'css', first, 'text/css')
        const direct = await fetch(originUrl(storage.bucket, firstKey))

        const miss = await fetch(`${edgeUrl}/${firstKey}`)
        const missBody = await miss.text()
        const hit = await fetch(`${edgeUrl}/${firstKey}`)
        await hit.text()

        const secondKey = await publishAsset(storage, ASSET_NAME, 'css', second, 'text/css')
        const updated = await fetch(`${edgeUrl}/${secondKey}`)
        const updatedBody = await updated.text()
        const old = await fetch(`${edgeUrl}/${firstKey}`)
        await old.text()

        return finish(
            {
                direct: direct.status,
                'edge-miss': miss.status,
                'edge-miss-x-cache-miss': miss.headers.get('x-cache') === 'MISS' ? 1 : 0,
                'edge-hit': hit.status,
                'cache-hit': hit.headers.get('x-cache') === 'HIT' ? 1 : 0,
                'new-name': secondKey !== firstKey ? 1 : 0,
                'new-url': updated.status,
                'content-changed': updatedBody !== missBody && updatedBody === second.toString() ? 1 : 0,
                'old-url': old.status,
            },
            {
                direct: [403],
                'edge-miss': [200],
                'edge-miss-x-cache-miss': [1],
                'edge-hit': [200],
                'cache-hit': [1],
                'new-name': [1],
                'new-url': [200],
                'content-changed': [1],
                'old-url': [200],
            },
        )
    } finally {
        edge.kill()
    }
}

runDemo(main)