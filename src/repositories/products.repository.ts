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

@Injectable()
export class ProductsRepository {
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
