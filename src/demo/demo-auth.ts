import 'reflect-metadata'
import { finish, prepareAuthUsers, runDemo, startDemoApp } from './auth-demo-support'

const main = async (): Promise<number> => {
    const demo = await startDemoApp()

    try {
        const { owner } = await prepareAuthUsers(demo.dataSource)

        const login = await demo.login(owner)
        const noToken = await demo.call('/auth/me')
        const withToken = await demo.call('/auth/me', { token: String(login.body.access_token) })
        const refresh = await demo.refresh(login.body.refresh_token)
        const accessToken = String(refresh.body.access_token)
        const logout = await demo.call('/auth/logout', { method: 'POST', token: accessToken })
        const afterLogout = await demo.call('/auth/me', { token: accessToken })
        const refreshAfterLogout = await demo.refresh(refresh.body.refresh_token)
        const oldAccessAfterLogout = await demo.call('/auth/me', { token: String(login.body.access_token) })

        return finish(
            {
                login: login.status,
                'no-token': noToken.status,
                'with-token': withToken.status,
                refresh: refresh.status,
                logout: logout.status,
                'after-logout': afterLogout.status,
                'refresh-after-logout': refreshAfterLogout.status,
                'old-access-after-logout': oldAccessAfterLogout.status,
            },
            {
                login: [200],
                'no-token': [401],
                'with-token': [200],
                refresh: [200],
                logout: [200, 204],
                'after-logout': [401],
                'refresh-after-logout': [401],
                'old-access-after-logout': [401],
            },
        )
    } finally {
        await demo.app.close()
    }
}

runDemo(main)
