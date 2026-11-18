import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const PORT = Number(process.env.DEMO_PORT ?? 22950)
export const BASE_URL = `http://127.0.0.1:${PORT}`

export const randomHex = (bytes) => randomBytes(bytes).toString('hex')

export const newTraceparent = () => {
    const traceId = randomHex(16)
    const parentId = randomHex(8)

    return { traceId, parentId, header: `00-${traceId}-${parentId}-01` }
}

const isUp = () =>
    fetch(`${BASE_URL}/readyz`)
        .then((response) => response.status === 200)
        .catch(() => false)

export const startServer = async () => {
    if (await isUp()) {
        throw new Error(`port ${PORT} is already serving, stop that process first`)
    }

    const child = spawn(process.execPath, ['dist/src/server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), STARTUP_DELAY_MS: '0', SHUTDOWN_DRAIN_MS: '0', LOG_LEVEL: 'info' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const lines = []

    for (const stream of [child.stdout, child.stderr]) {
        createInterface({ input: stream }).on('line', (line) => line.trim() && lines.push(line))
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null) {
            throw new Error(`server exited with ${child.exitCode}:\n${lines.slice(-10).join('\n')}`)
        }

        if (await isUp()) {
            return {
                lines,
                stop: async () => {
                    child.kill('SIGTERM')
                    await once(child, 'exit')
                },
            }
        }

        await sleep(500)
    }

    child.kill('SIGKILL')
    throw new Error('server did not become ready in 60 seconds')
}

export const parseLog = (lines) => ({
    entries: lines.map((line) => {
        try {
            return JSON.parse(line)
        } catch {
            return null
        }
    }),
    nonJson: lines.filter((line) => {
        try {
            JSON.parse(line)
            return false
        } catch {
            return true
        }
    }).length,
})

export const prepareDemoUsers = async () => {
    require('reflect-metadata')
    const { AppDataSource } = require(`${ROOT}dist/src/data-source.js`)
    const support = require(`${ROOT}dist/src/demo/auth-demo-support.js`)
    const dataSource = await AppDataSource.initialize()

    try {
        const users = await support.prepareAuthUsers(dataSource)

        return { users, password: support.AUTH_DEMO_PASSWORD, productName: support.AUTH_DEMO_PRODUCT }
    } finally {
        await dataSource.destroy()
    }
}

export const request = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()

    return { status: response.status, body: text ? JSON.parse(text) : {} }
}

export const login = async (email, password) => (await request('/auth/login', { method: 'POST', body: { email, password } })).body.access_token

export const finish = (summary, invariants) => {
    for (const [key, value] of Object.entries(summary)) {
        console.log(`${key}=${value}`)
    }

    const broken = invariants.filter(([, holds]) => !holds).map(([name]) => name)

    for (const name of broken) {
        console.error(`invariant broken: ${name}`)
    }

    process.exit(broken.length === 0 ? 0 : 1)
}

export const run = (main) =>
    main().catch((error) => {
        console.error(error)
        process.exit(1)
    })
