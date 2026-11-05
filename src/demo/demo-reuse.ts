import 'reflect-metadata'
import { finish, prepareAuthUsers, runDemo, startDemoApp } from './auth-demo-support'

const main = async (): Promise<number> => {
    const demo = await startDemoApp()

    try {
        const { owner } = await prepareAuthUsers(demo.dataSource)

        const login = await demo.login(owner)
        const r1 = login.body.refresh_token
        const r1Refresh = await demo.refresh(r1)
        const r2 = r1Refresh.body.refresh_token
        const r1Reuse = await demo.refresh(r1)
        const r2AfterReuse = await demo.refresh(r2)
        const accessAfterReuse = await demo.call('/auth/me', { token: String(r1Refresh.body.access_token) })

        const [family] = await demo.dataSource.query<{ tokens: string; revoked: string }[]>(
            `SELECT count(*) AS tokens, count(revoked_at) AS revoked FROM refresh_tokens WHERE user_id = $1`,
            [owner.id],
        )

        return finish(
            {
                login: login.status,
                'r1-refresh': r1Refresh.status,
                'r1-reuse': r1Reuse.status,
                'r2-after-reuse': r2AfterReuse.status,
                'access-after-reuse': accessAfterReuse.status,
                'family-tokens': Number(family.tokens),
                'family-revoked': Number(family.revoked),
            },
            {
                login: [200],
                'r1-refresh': [200],
                'r1-reuse': [401],
                'r2-after-reuse': [401],
                'access-after-reuse': [401],
                'family-tokens': [2],
                'family-revoked': [2],
            },
        )
    } finally {
        await demo.app.close()
    }
}

runDemo(main)
