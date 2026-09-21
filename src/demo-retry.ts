import 'reflect-metadata'
import { setTimeout as sleep } from 'node:timers/promises'
import { AppDataSource } from './data-source'
import { User } from './entities/user.entity'
import { withRetry } from './services/with-retry'

const CONCURRENT_DEBITS = 3
const DEBIT_AMOUNT = 10_000
const INITIAL_BALANCE = 1_000_000
const HOLD_MS = 100

const account = {
    email: 'retry-demo@example.com',
    phone: '+380980000001',
    name: 'Retry Demo',
    balance: INITIAL_BALANCE,
}

const debit = (userId: string, amount: number): Promise<void> =>
    AppDataSource.transaction('REPEATABLE READ', async (manager) => {
        const [{ balance }] = await manager.query<{ balance: number }[]>(
            'SELECT balance FROM users WHERE id = $1',
            [userId],
        )

        await sleep(HOLD_MS)

        await manager.query('UPDATE users SET balance = $1 WHERE id = $2', [
            balance - amount,
            userId,
        ])
    })

const main = async () => {
    await AppDataSource.initialize()

    try {
        const userRepository = AppDataSource.getRepository(User)

        await userRepository
            .createQueryBuilder()
            .insert()
            .values(account)
            .orIgnore()
            .execute()

        await userRepository.update({ email: account.email }, { balance: INITIAL_BALANCE })

        const user = await userRepository.findOneByOrFail({ email: account.email })

        let retries = 0

        console.log(`initial balance: ${INITIAL_BALANCE}`)
        console.log(`concurrent debits: ${CONCURRENT_DEBITS} x ${DEBIT_AMOUNT}`)

        await Promise.all(
            Array.from({ length: CONCURRENT_DEBITS }, (_, index) =>
                withRetry(() => debit(user.id, DEBIT_AMOUNT), {
                    label: `debit-${index + 1}`,
                    onRetry: () => {
                        retries += 1
                    },
                }),
            ),
        )

        const { balance: finalBalance } = await userRepository.findOneByOrFail({ id: user.id })
        const expectedBalance = INITIAL_BALANCE - CONCURRENT_DEBITS * DEBIT_AMOUNT

        console.log(`retries: ${retries}`)
        console.log(`final balance: ${finalBalance}`)
        console.log(`expected balance: ${expectedBalance}`)

        if (finalBalance !== expectedBalance || retries < 1) {
            console.error('INVARIANT VIOLATED: lost update or no serialization failure was provoked')
            process.exitCode = 1

            return
        }

        console.log('invariant holds: every debit applied exactly once')
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})