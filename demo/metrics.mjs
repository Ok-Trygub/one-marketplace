import { setTimeout as sleep } from 'node:timers/promises'
import { BASE_URL, finish, login, prepareDemoUsers, request, run, startServer } from './observability-support.mjs'

const ROUTE = '/orders/:id'
const DISTINCT_IDS = 100
const FAILING = 5
const OUT_OF_RANGE_ID = '99999999999999999999'
const TOP_BUCKET = '30'

const scrape = async () => (await fetch(`${BASE_URL}/metrics`)).text()

const samples = (text, name) =>
    text
        .split('\n')
        .filter((line) => line.startsWith(`${name}{`))
        .map((line) => {
            const [, labels, value] = /^[^{]+\{(.*)\} (\S+)$/.exec(line) ?? []
            return { labels: Object.fromEntries([...labels.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])), value: Number(value) }
        })

const sum = (text, name, match) => samples(text, name).filter((sample) => match(sample.labels)).reduce((total, sample) => total + sample.value, 0)

const onRoute = (labels) => labels.route === ROUTE

run(async () => {
    const { users, password } = await prepareDemoUsers()
    const server = await startServer()
    let summary
    let invariants

    try {
        const token = await login(users.owner.email, password)
        const get = (id) => request(`/orders/${id}`, { token })

        await get('900000000001')
        await get(`${OUT_OF_RANGE_ID}0`)

        const before = await scrape()
        const statuses = []

        for (let index = 0; index < DISTINCT_IDS; index += 1) {
            statuses.push((await get(String(910000000000 + index))).status)
        }

        for (let index = 1; index <= FAILING; index += 1) {
            statuses.push((await get(`${OUT_OF_RANGE_ID}${index}`)).status)
        }

        const after = await scrape()
        const sentOk = statuses.filter((status) => status < 500).length
        const sentFail = statuses.filter((status) => status >= 500).length
        const counterDelta = sum(after, 'http_requests_total', onRoute) - sum(before, 'http_requests_total', onRoute)
        const errorsDelta =
            sum(after, 'http_requests_total', (labels) => onRoute(labels) && labels.status.startsWith('5')) -
            sum(before, 'http_requests_total', (labels) => onRoute(labels) && labels.status.startsWith('5'))
        const seriesBefore = samples(before, 'http_requests_total').length
        const seriesAfter = samples(after, 'http_requests_total').length
        const aboveTopBucket =
            sum(after, 'http_request_duration_seconds_count', onRoute) -
            sum(after, 'http_request_duration_seconds_bucket', (labels) => onRoute(labels) && labels.le === TOP_BUCKET)

        await sleep(6000)
        const up = await fetch(`${process.env.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(`up{instance="host.docker.internal:${new URL(BASE_URL).port}"}`)}`)
            .then((response) => response.json())
            .then((body) => Number(body.data?.result?.[0]?.value?.[1] ?? 0))
            .catch(() => 0)

        summary = {
            'sent-ok': sentOk,
            'sent-fail': sentFail,
            'counter-delta': counterDelta,
            'errors-delta': errorsDelta,
            'above-top-bucket': aboveTopBucket,
            'series-before': seriesBefore,
            'series-after': seriesAfter,
            'prometheus-target-up': up,
        }
        invariants = [
            ['sent>=50', sentOk + sentFail >= 50],
            ['counter-delta=sent', counterDelta === sentOk + sentFail],
            ['errors-delta=sent-fail', errorsDelta === sentFail && sentFail > 0],
            ['above-top-bucket=0', aboveTopBucket === 0],
            ['series-after=series-before', seriesAfter === seriesBefore],
        ]
    } finally {
        await server.stop()
    }

    finish(summary, invariants)
})
