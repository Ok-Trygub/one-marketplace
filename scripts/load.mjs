import { createWriteStream } from 'node:fs'
import http from 'node:http'

const [url, output] = process.argv.slice(2)
const rate = Number(process.env.LOAD_RATE ?? '100')

if (!url || !output || !(rate > 0)) {
    console.error('usage: LOAD_RATE=<requests per second> node scripts/load.mjs <url> <output file>')
    process.exit(1)
}

const intervalMs = 1000 / rate
const codes = createWriteStream(output, { flags: 'a' })
const pending = new Set()
const agent = new http.Agent({ keepAlive: true, maxSockets: 32, timeout: 4000 })

const requestOnce = () =>
    new Promise((resolve) => {
        const request = http.get(url, { agent, timeout: 5000 }, (response) => {
            response.resume()
            response.on('end', () => resolve(String(response.statusCode)))
            response.on('error', () => resolve('000'))
        })

        request.on('timeout', () => request.destroy())
        request.on('error', () => resolve('000'))
    })

const timer = setInterval(() => {
    const request = requestOnce().then((code) => {
        codes.write(`${code}\n`)
        pending.delete(request)
    })

    pending.add(request)
}, intervalMs)

const stop = async () => {
    clearInterval(timer)
    await Promise.all(pending)
    agent.destroy()
    codes.end()
}

process.once('SIGTERM', stop)
process.once('SIGINT', stop)
