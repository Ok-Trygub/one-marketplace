import { open, readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'

type PutJob = { mode: 'put'; url: string; contentType: string; file: string }

type PartsJob = {
    mode: 'parts'
    file: string
    partSize: number
    parts: { part_number: number; url: string }[]
    crashAfter?: number
}

const readPart = async (file: string, partNumber: number, partSize: number): Promise<Uint8Array<ArrayBuffer>> => {
    const handle = await open(file, 'r')

    try {
        const buffer = new Uint8Array(partSize)
        const { bytesRead } = await handle.read(buffer, 0, partSize, (partNumber - 1) * partSize)

        return buffer.slice(0, bytesRead)
    } finally {
        await handle.close()
    }
}

const main = async (): Promise<number> => {
    const job = JSON.parse(await text(process.stdin)) as PutJob | PartsJob

    if (job.mode === 'put') {
        const response = await fetch(job.url, {
            method: 'PUT',
            headers: { 'Content-Type': job.contentType },
            body: await readFile(job.file),
        })

        console.log(response.status)

        return 0
    }

    let uploaded = 0

    for (const part of job.parts) {
        const response = await fetch(part.url, { method: 'PUT', body: await readPart(job.file, part.part_number, job.partSize) })

        if (response.status !== 200) {
            console.error(`part ${part.part_number} failed with ${response.status}`)
            return 1
        }

        uploaded += 1

        if (uploaded === job.crashAfter) {
            console.log(uploaded)
            process.exit(137)
        }
    }

    console.log(uploaded)

    return 0
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })