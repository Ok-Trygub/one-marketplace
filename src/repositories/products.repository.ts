import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { Product } from '../entities/product.entity'
import { OrderItem } from '../entities/order-item.entity'

export type CreateProductInput = {
    name: string
    description: string
    price: number
    stock: number
}

export type ProductRevenue = {
    productId: string
    productName: string
    unitsSold: string
    revenue: string
}

export type ProductCardRow = {
    id: string
    name: string
    price: number
    stock: number
    unitsSold: number
}

@Injectable()
export class ProductsRepository {
    cardQueries = 0

    constructor(private readonly dataSource: DataSource) {}

    create(input: CreateProductInput): Promise<Product> {
        const repository = this.dataSource.getRepository(Product)

        return repository.save(repository.create(input))
    }

    findById(id: string): Promise<Product | null> {
        return this.dataSource.getRepository(Product).findOneBy({ id })
    }

    findAll(): Promise<Product[]> {
        return this.dataSource.getRepository(Product).find({ order: { id: 'ASC' } })
    }

    findCard(id: string): Promise<ProductCardRow | undefined> {
        this.cardQueries += 1

        return this.dataSource
            .getRepository(Product)
            .createQueryBuilder('product')
            .leftJoin('product.orderItems', 'item')
            .leftJoin('item.order', 'o', 'o.status = :status', { status: 'paid' })
            .select('product.id', 'id')
            .addSelect('product.name', 'name')
            .addSelect('product.price', 'price')
            .addSelect('product.stock', 'stock')
            .addSelect('COALESCE(SUM(item.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::int', 'unitsSold')
            .where('product.id = :id', { id })
            .groupBy('product.id')
            .getRawOne<ProductCardRow>()
    }

    revenueByProduct(): Promise<ProductRevenue[]> {
        return this.dataSource
            .getRepository(OrderItem)
            .createQueryBuilder('item')
            .innerJoin('item.order', 'o')
            .innerJoin('item.product', 'product')
            .select('product.id', 'productId')
            .addSelect('product.name', 'productName')
            .addSelect('SUM(item.quantity)', 'unitsSold')
            .addSelect('SUM(item.quantity * item.unitPrice)', 'revenue')
            .where('o.status = :status', { status: 'paid' })
            .groupBy('product.id')
            .addGroupBy('product.name')
            .orderBy('revenue', 'DESC')
            .getRawMany<ProductRevenue>()
    }
}