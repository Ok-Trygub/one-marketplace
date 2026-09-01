import {NextFunction, Request, Response} from 'express'
import {handleIdempotency} from "../services/idempotency.service";
import {createProduct as createProductService} from '../services/products.service'
import {products} from "../data/products";


export const getProducts = (_req: Request, res: Response) => {
    res.status(200).json({
        items: products,
        next_cursor: null,
    })
}


export const createProduct = (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const result = handleIdempotency(
            req.header('Idempotency-Key')!,
            req.body,
            () => createProductService(req.body),
        )

        if (result.replay) {
            res.set('Idempotency-Replay', 'true')
        }

        res.status(result.statusCode).json(result.response)
    } catch (error) {
        next(error)
    }
}