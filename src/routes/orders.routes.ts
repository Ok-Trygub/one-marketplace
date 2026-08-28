import { Router } from 'express'
import {createOrder, getOrderById, getOrders} from '../controllers/orders.controller'

const router = Router()

router.get('/', getOrders)
router.post('/', createOrder)
router.get('/:id', getOrderById)

export default router