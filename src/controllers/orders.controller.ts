import {Request, Response, NextFunction} from 'express'
import {createOrder as createOrderService, findOrderById, findOrders} from '../services/orders.service'
import {handleIdempotency} from '../services/idempotency.service'


type OrderParams = {
    id: string
}


export const createOrder = (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const result = handleIdempotency(
            req.header('Idempotency-Key')!,
            req.body,
            () => createOrderService(req.body),
        )

        if (result.replay) {
            res.set('Idempotency-Replay', 'true')
        }

        res.status(result.statusCode).json(result.response)
    } catch (error) {
        next(error)
    }
}

export const getOrders = (_req: Request, res: Response) => {
    const orders = findOrders()

    res.status(200).json({
        items: orders,
        next_cursor: null,
    })
}

export const getOrderById = (
    req: Request<OrderParams>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const order = findOrderById(req.params.id)

        if (!order) {
            const error = new Error(
                `Order '${req.params.id}' was not found`,
            ) as Error & { status: number }

            error.status = 404

            throw error
        }

        res.status(200).json(order)
    } catch (error) {
        next(error)
    }
}