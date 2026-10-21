import amqp from 'amqplib'
import type { ChannelModel } from 'amqplib'

export const BROKER_CONNECTION = 'BROKER_CONNECTION'

const env = (name: string): string => {
    const value = process.env[name]

    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

export const connectBroker = (url: string = env('BROKER_URL')): Promise<ChannelModel> => {
    return amqp.connect(url)
}
