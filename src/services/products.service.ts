import { products } from '../data/products'

type CreateProduct = {
    name: string
    price_cents: number
}

export type Product = {
    id: string
    name: string
    price_cents: number
}


export const findProductById = (id: string): Product | undefined => {
    return products.find((product) => product.id === id)
}


export const createProduct = (data: CreateProduct): Product => {
    const product: Product = {
        id: `product-${products.length + 1}`,
        name: data.name,
        price_cents: data.price_cents,
    }

    products.push(product)

    return product
}