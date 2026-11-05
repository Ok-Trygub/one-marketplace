import 'reflect-metadata'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { finish, runDemo, startDemoApp } from './auth-demo-support'
import type { DemoApp } from './auth-demo-support'
import { AUTH_DEMO_PASSWORD } from './auth-demo-support'
import { FILES_DEMO_USER, isPortAlive, prepareFilesUser, runOfflineClient, standaloneStorage } from './files-demo-support'

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1016, 7)])

type Intent = { file_id: string; key: string; upload: { url: string; headers: Record<string, string> } }

const createIntent = (demo: DemoApp, token: string, filename: string) =>
    demo.call('/uploads/intent', {
        method: 'POST',
        token,
        body: { filename, content_type: 'image/png', size: PNG.length },
    })

const commit = (demo: DemoApp, token: string, fileId: string) =>
    demo.call('/uploads/commit', { method: 'POST', token, body: { file_id: fileId } })

const put = (url: string, body: Buffer = PNG) =>
    fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(body) }).then(
        (response) => response.status,
    )

const main = async (): Promise<number> => {
    const storage = standaloneStorage()
    const workdir = await mkdtemp(path.join(tmpdir(), 'demo-upload-'))
    const file = path.join(workdir, 'photo.png')
    let demo: DemoApp | undefined = await startDemoApp()

    try {
        await storage.ensureBucket()
        await prepareFilesUser(demo.dataSource, storage)
        await writeFile(file, PNG)

        const login = await demo.call('/auth/login', {
            method: 'POST',
            body: { email: FILES_DEMO_USER.email, password: AUTH_DEMO_PASSWORD },
        })
        const token = String(login.body.access_token)

        const intent = await createIntent(demo, token, '../../etc/passwd')
        const { file_id: fileId, key, upload } = intent.body as Intent

        const empty = (await createIntent(demo, token, 'empty.png')).body as Intent
        const commitWithoutBytes = await commit(demo, token, empty.file_id)

        const tamperedUrl = new URL(upload.url)
        tamperedUrl.pathname = tamperedUrl.pathname.replace(/[^/]+$/, 'not-signed.png')

        const shortLived = await storage.presignPut(key, 'image/png', 1)
        await sleep(2500)
        const expired = await put(shortLived)

        const { port } = demo.app.getHttpServer().address() as AddressInfo
        await demo.app.close()
        demo = undefined
        const apiAlive = await isPortAlive(port)

        const offline = await runOfflineClient({ mode: 'put', url: upload.url, contentType: 'image/png', file })
        const tampered = await put(tamperedUrl.toString())

        demo = await startDemoApp()
        const committed = await commit(demo, token, fileId)

        return finish(
            {
                intent: intent.status,
                'key-from-server': /etc|passwd|\.\./.test(key) ? 0 : 1,
                'api-alive': apiAlive,
                'put-offline': offline.code === 0 ? Number(offline.output) : 0,
                commit: committed.status,
                'commit-without-bytes': commitWithoutBytes.status,
                tampered,
                expired,
            },
            {
                intent: [200],
                'key-from-server': [1],
                'api-alive': [0],
                'put-offline': [200],
                commit: [200],
                'commit-without-bytes': [409],
                tampered: [403],
                expired: [403],
            },
        )
    } finally {
        await demo?.app.close()
        await rm(workdir, { recursive: true, force: true })
    }
}

runDemo(main)