import { createServer, connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { DataSource } from 'typeorm'
import { hashPassword } from '../auth/password'
import { User } from '../entities/user.entity'
import { createStorageClient, storageBucketFromEnv, storageConnectionFromEnv } from '../storage/storage-client'
import { StorageService } from '../storage/storage.service'
import { AUTH_DEMO_PASSWORD } from './auth-demo-support'

export const FILES_DEMO_USER = {
    email: 'files-demo@example.com',
    phone: '+380990000901',
    name: 'Files Demo User',
    role: 'buyer' as const,
}

export const OFFLINE_CLIENT = path.join(__dirname, 'offline-client.js')

export const standaloneStorage = (): StorageService =>
    new StorageService(createStorageClient(storageConnectionFromEnv()), storageBucketFromEnv())

export const removePrefix = async (storage: StorageService, prefix: string): Promise<void> => {
    for (const upload of await storage.listMultipartUploads(prefix)) {
        await storage.abortMultipart(upload.key, upload.uploadId)
    }

    for (const key of await storage.listKeys(prefix)) {
        await storage.deleteObject(key)
    }
}

export const prepareFilesUser = async (dataSource: DataSource, storage: StorageService): Promise<User> => {
    const users = dataSource.getRepository(User)

    await users.upsert(
        { ...FILES_DEMO_USER, balance: 0, passwordHash: await hashPassword(AUTH_DEMO_PASSWORD) },
        ['email'],
    )

    const user = await users.findOneByOrFail({ email: FILES_DEMO_USER.email })

    await removePrefix(storage, `uploads/${user.id}/`)
    await dataSource.query(`DELETE FROM files WHERE owner_id = $1`, [user.id])

    return user
}

export const isPortAlive = (port: number): Promise<0 | 1> =>
    new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port })

        socket.once('connect', () => {
            socket.destroy()
            resolve(1)
        })
        socket.once('error', () => resolve(0))
    })

export const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = createServer()

        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo

            server.close(() => resolve(port))
        })
    })

export const runOfflineClient = (job: unknown): Promise<{ code: number; output: string }> =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [OFFLINE_CLIENT], {
            env: { PATH: process.env.PATH ?? '' },
            stdio: ['pipe', 'pipe', 'inherit'],
        })
        let output = ''

        child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString()
        })
        child.once('error', reject)
        child.once('close', (code) => resolve({ code: code ?? 1, output: output.trim() }))
        child.stdin.end(JSON.stringify(job))
    })