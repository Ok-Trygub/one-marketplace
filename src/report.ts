import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { OrderItem } from './entities/order-item.entity'

type RevenueRow = {
    productId: string
    productName: string
    unitsSold: string
    revenue: string
}

const formatUah = (kopiykas: string): string => {
    const value = BigInt(kopiykas)
    const hryvnias = value / 100n
    const rest = (value % 100n).toString().padStart(2, '0')

    return `${hryvnias}.${rest}`
}

const main = async () => {
    await AppDataSource.initialize()

    try {
        const rows = await AppDataSource.getRepository(OrderItem)
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
            .getRawMany<RevenueRow>()

        console.table(
            rows.map((row) => ({
                product: row.productName,
                unitsSold: row.unitsSold,
                revenueUah: formatUah(row.revenue),
            })),
        )
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})