import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AUTH_DEMO_PASSWORD, finish, runDemo, startDemoApp } from './auth-demo-support'
import { FILES_DEMO_USER, prepareFilesUser, runOfflineClient, standaloneStorage } from './files-demo-support'

const MIB = 1024 * 1024
const FILE_SIZE = 15 * MIB

type Plan = { part_size: number; part_count: number; uploaded: number[]; parts: { part_number: number; url: string }[] }

const main = async (): Promise<number> => {
    const storage = standaloneStorage()
    const demo = await startDemoApp()
    const workdir = await mkdtemp(path.join(tmpdir(), 'demo-multipart-'))
    const file = path.join(workdir, 'dump.gz')

    try {
        await storage.ensureBucket()
        await prepareFilesUser(demo.dataSource, storage)

        const body = Buffer.alloc(FILE_SIZE)
        for (let offset = 0; offset < FILE_SIZE; offset += 1) {
            body[offset] = (offset * 31 + 7) % 251
        }
        await writeFile(file, body)

        const login = await demo.call('/auth/login', {
            method: 'POST',
            body: { email: FILES_DEMO_USER.email, password: AUTH_DEMO_PASSWORD },
        })
        const token = String(login.body.access_token)

        const intent = await demo.call('/uploads/intent', {
            method: 'POST',
            token,
            body: { filename: 'dump.gz', content_type: 'application/gzip', size: FILE_SIZE },
        })
        const fileId = String(intent.body.file_id)
        const key = String(intent.body.key)
        const plan = intent.body.upload as Plan

        const first = await runOfflineClient({ mode: 'parts', file, partSize: plan.part_size, parts: plan.parts, crashAfter: 2 })
        const headBeforeComplete = (await storage.head(key)) ? 200 : 404

        const resume = await demo.call(`/uploads/${fileId}/parts`, { token })
        const remaining = resume.body.upload as Plan
        const second = await runOfflineClient({ mode: 'parts', file, partSize: remaining.part_size, parts: remaining.parts })

        const completed = await demo.call('/uploads/commit', { method: 'POST', token, body: { file_id: fileId } })
        const object = await storage.head(key)
        const md5 = createHash('md5').update(body).digest('hex')

        return finish(
            {
                'part-count': plan.part_count,
                'first-process-parts': Number(first.output),
                'first-process-crashed': first.code === 0 ? 0 : 1,
                'head-before-complete': headBeforeComplete,
                'resumed-parts': second.code === 0 ? Number(second.output) : 0,
                complete: completed.status,
                'size-match': object?.size === FILE_SIZE ? 1 : 0,
                'etag-multipart': object && new RegExp(`-${plan.part_count}"$`).test(object.etag) && !object.etag.includes(md5) ? 1 : 0,
            },
            {
                'part-count': [3],
                'first-process-parts': [2],
                'first-process-crashed': [1],
                'head-before-complete': [404],
                'resumed-parts': [1],
                complete: [200],
                'size-match': [1],
                'etag-multipart': [1],
            },
        )
    } finally {
        await demo.app.close()
        await rm(workdir, { recursive: true, force: true })
    }
}

runDemo(main)