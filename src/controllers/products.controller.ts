import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ProductsRepository } from '../repositories/products.repository'
import { ProductCardService } from '../services/product-card.service'
import type { ProductCard } from '../services/product-card.service'
import { handleIdempotency } from '../services/idempotency.service'
import { RateLimitGuard } from '../http/rate-limit.guard'
import type { Product } from '../entities/product.entity'

export type ProductResponse = {
    id: string
    name: string
    price_cents: number
    stock: number
}

export type CreateProductBody = {
    name: string
    price_cents: number
    description?: string
    stock?: number
}

export const toProductResponse = (product: Product): ProductResponse => ({
    id: product.id,
    name: product.name,
    price_cents: product.price,
    stock: product.stock,
})

const isId = (value: string): boolean => /^\d+$/.test(value)

@Controller('products')
export class ProductsController {
    constructor(
        private readonly products: ProductsRepository,
        private readonly productCards: ProductCardService,
    ) {}

    @Get()
    async list(): Promise<{ items: ProductResponse[]; next_cursor: null }> {
        const products = await this.products.findAll()

        return { items: products.map(toProductResponse), next_cursor: null }
    }

    @Get(':id')
    @UseGuards(RateLimitGuard)
    async getById(@Param('id') id: string): Promise<ProductCard> {
        const card = isId(id) ? await this.productCards.get(id) : null

        if (!card) {
            throw new NotFoundException(`Product '${id}' was not found`)
        }

        return card
    }

    @Post()
    @HttpCode(201)
    async create(
        @Headers('idempotency-key') idempotencyKey: string,
        @Body() body: CreateProductBody,
        @Res({ passthrough: true }) response: Response,
    ): Promise<ProductResponse> {
        const result = await handleIdempotency(idempotencyKey, body, async () =>
            toProductResponse(
                await this.products.create({
                    name: body.name,
                    description: body.description ?? '',
                    price: body.price_cents,
                    stock: body.stock ?? 0,
                }),
            ),
        )

        if (result.replay) {
            response.set('Idempotency-Replay', 'true')
        }

        return result.response
    }
}