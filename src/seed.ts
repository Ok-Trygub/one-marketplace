import 'reflect-metadata'
import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm'
import { AppDataSource } from './data-source'
import { User } from './entities/user.entity'
import { Product } from './entities/product.entity'
import { Order } from './entities/order.entity'
import { OrderItem } from './entities/order-item.entity'

type OrderStatus = 'pending' | 'paid' | 'cancelled'

type OrderSeed = {
    email: string
    status: OrderStatus
    createdAt: string
    items: { product: string; quantity: number }[]
}

const users = [
    { email: 'olena.shevchenko@gmail.com', phone: '+380501000001', name: 'Олена Шевченко' },
    { email: 'andrii.bondarenko@ukr.net', phone: '+380671000002', name: 'Андрій Бондаренко' },
    { email: 'iryna.kovalenko@gmail.com', phone: '+380931000003', name: 'Ірина Коваленко' },
    { email: 'dmytro.tkachenko@i.ua', phone: '+380961000004', name: 'Дмитро Ткаченко' },
    { email: 'nataliia.kravchenko@gmail.com', phone: '+380661000005', name: 'Наталія Кравченко' },
    { email: 'taras.oliinyk@outlook.com', phone: '+380731000006', name: 'Тарас Олійник' },
]

const products = [
    { name: 'Холодильник Samsung SM-1001', description: 'Двокамерний холодильник з системою No Frost і зоною свіжості для овочів. Колір: сріблястий. Гарантія 24 місяці.', price: 2899900 },
    { name: 'Пральна машина Bosch BS-1002', description: 'Пральна машина з фронтальним завантаженням і інверторним двигуном. Тихий режим роботи. Гарантія 36 місяців.', price: 1849900 },
    { name: 'Робот-пилосос Xiaomi MI-1003', description: 'Робот-пилосос з лазерною навігацією, побудовою карти і станцією самоочищення. Керування через мобільний застосунок.', price: 1299900 },
    { name: 'Кавомашина Philips PH-1004', description: 'Автоматична кавомашина з вбудованою кавомолкою і капучинатором. Сенсорна панель керування.', price: 2199900 },
    { name: 'Телевізор LG LG-1005', description: 'Телевізор з роздільною здатністю 4K, підтримкою HDR і голосовим керуванням. Діагональ 55 дюймів.', price: 2499900 },
    { name: 'Ноутбук Lenovo LN-1006', description: 'Ноутбук з екраном 15,6 дюйма, швидким накопичувачем і легким корпусом для роботи.', price: 3999900 },
    { name: 'Навушники Sony SN-1007', description: 'Бездротові навушники з активним шумозаглушенням і автономністю до 30 годин.', price: 899900 },
    { name: 'Електрочайник Tefal TF-1008', description: 'Електрочайник зі скла на 1,7 літра з підсвічуванням і захистом від перегріву.', price: 149900 },
]

const orders: OrderSeed[] = [
    {
        email: 'olena.shevchenko@gmail.com',
        status: 'paid',
        createdAt: '2026-08-03T10:15:00Z',
        items: [
            { product: 'Холодильник Samsung SM-1001', quantity: 1 },
            { product: 'Електрочайник Tefal TF-1008', quantity: 2 },
        ],
    },
    {
        email: 'andrii.bondarenko@ukr.net',
        status: 'paid',
        createdAt: '2026-08-05T14:40:00Z',
        items: [
            { product: 'Ноутбук Lenovo LN-1006', quantity: 1 },
            { product: 'Навушники Sony SN-1007', quantity: 1 },
        ],
    },
    {
        email: 'iryna.kovalenko@gmail.com',
        status: 'pending',
        createdAt: '2026-08-12T09:05:00Z',
        items: [
            { product: 'Кавомашина Philips PH-1004', quantity: 1 },
        ],
    },
    {
        email: 'dmytro.tkachenko@i.ua',
        status: 'cancelled',
        createdAt: '2026-08-18T18:30:00Z',
        items: [
            { product: 'Телевізор LG LG-1005', quantity: 1 },
            { product: 'Робот-пилосос Xiaomi MI-1003', quantity: 1 },
        ],
    },
    {
        email: 'nataliia.kravchenko@gmail.com',
        status: 'paid',
        createdAt: '2026-08-21T12:00:00Z',
        items: [
            { product: 'Пральна машина Bosch BS-1002', quantity: 1 },
            { product: 'Електрочайник Tefal TF-1008', quantity: 1 },
            { product: 'Навушники Sony SN-1007', quantity: 2 },
        ],
    },
    {
        email: 'taras.oliinyk@outlook.com',
        status: 'paid',
        createdAt: '2026-09-01T16:20:00Z',
        items: [
            { product: 'Робот-пилосос Xiaomi MI-1003', quantity: 1 },
        ],
    },
    {
        email: 'olena.shevchenko@gmail.com',
        status: 'paid',
        createdAt: '2026-09-10T11:45:00Z',
        items: [
            { product: 'Навушники Sony SN-1007', quantity: 1 },
        ],
    },
]

const ensure = async <T extends ObjectLiteral>(
    repository: Repository<T>,
    where: FindOptionsWhere<T>,
    values: NoInfer<DeepPartial<T>>,
): Promise<T> => {
    const existing = await repository.findOneBy(where)

    if (existing) {
        return existing
    }

    return repository.save(repository.create(values))
}

const pick = <T>(map: Map<string, T>, key: string): T => {
    const value = map.get(key)

    if (!value) {
        throw new Error(`Seed data is inconsistent: "${key}" is not defined`)
    }

    return value
}

const main = async () => {
    await AppDataSource.initialize()

    try {
        const userRepository = AppDataSource.getRepository(User)
        const productRepository = AppDataSource.getRepository(Product)
        const orderRepository = AppDataSource.getRepository(Order)
        const orderItemRepository = AppDataSource.getRepository(OrderItem)

        const usersByEmail = new Map<string, User>()

        for (const seed of users) {
            const user = await ensure(userRepository, { email: seed.email }, seed)

            usersByEmail.set(seed.email, user)
        }

        const productsByName = new Map<string, Product>()

        for (const seed of products) {
            const product = await ensure(productRepository, { name: seed.name }, seed)

            productsByName.set(seed.name, product)
        }

        for (const seed of orders) {
            const user = pick(usersByEmail, seed.email)
            const createdAt = new Date(seed.createdAt)

            const lines = seed.items.map((item) => {
                const product = pick(productsByName, item.product)

                return { product, quantity: item.quantity, unitPrice: product.price }
            })

            const total = lines.reduce(
                (sum, line) => sum + line.quantity * line.unitPrice,
                0,
            )

            const order = await ensure(
                orderRepository,
                { userId: user.id, createdAt },
                { userId: user.id, status: seed.status, total, createdAt },
            )

            for (const line of lines) {
                await ensure(
                    orderItemRepository,
                    { orderId: order.id, productId: line.product.id },
                    {
                        orderId: order.id,
                        productId: line.product.id,
                        quantity: line.quantity,
                        unitPrice: line.unitPrice,
                    },
                )
            }
        }

        console.log({
            users: await userRepository.count(),
            products: await productRepository.count(),
            orders: await orderRepository.count(),
            orderItems: await orderItemRepository.count(),
        })
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})