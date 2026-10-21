import { RabbitMQContainer } from '@testcontainers/rabbitmq'
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq'
import { connectBroker } from '../../../src/messaging/broker'
import { assertTopology } from '../../../src/messaging/topology'

export const RABBITMQ_IMAGE = 'rabbitmq:4.2.9-management'

export type TestBroker = {
    container: StartedRabbitMQContainer
    url: string
    stop: () => Promise<void>
}

const bootstrapTopology = async (url: string): Promise<void> => {
    const connection = await connectBroker(url)
    const channel = await connection.createChannel()

    await assertTopology(channel)
    await connection.close()
}

export const startTestBroker = async (): Promise<TestBroker> => {
    const container = await new RabbitMQContainer(RABBITMQ_IMAGE).start()
    const url = container.getAmqpUrl()

    await bootstrapTopology(url)

    return {
        container,
        url,
        stop: () => container.stop().then(() => undefined),
    }
}
