import express from 'express'
import * as OpenApiValidator from 'express-openapi-validator'
import path from 'node:path'
import productsRouter from './routes/products.routes'
import { errorHandler } from './middleware/error-handler'
import ordersRouter from './routes/orders.routes'


const app = express()
const port = 3000

app.use(express.json())

app.use(
    OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'openapi/openapi.yaml'),
        validateRequests: true,
        validateResponses: true,
    }),
)

app.use('/products', productsRouter)
app.use('/orders', ordersRouter)


app.use(errorHandler)


app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
})