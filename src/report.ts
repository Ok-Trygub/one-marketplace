import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { ProductsRepository } from './repositories/products.repository'

const formatUah = (kopiykas: string): string => {
    const value = BigInt(kopiykas)
    const hryvnias = value / 100n
    const rest = (value % 100n).toString().padStart(2, '0')

    return `${hryvnias}.${rest}`
}

const main = async () => {
    await AppDataSource.initialize()

    try {
        const rows = await new ProductsRepository(AppDataSource).revenueByProduct()

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