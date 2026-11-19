import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import type { Request } from 'express'
import { routeOf, UNMATCHED_ROUTE } from './observability/route'

export const otelSdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'marketplace-api',
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? { traceExporter: new OTLPTraceExporter() } : { spanProcessors: [] }),
    instrumentations: [
        new HttpInstrumentation({
            applyCustomAttributesOnSpan: (span, request) => {
                const route = routeOf(request as unknown as Request)

                if (route !== UNMATCHED_ROUTE) {
                    span.setAttribute('http.route', route)
                    span.updateName(`${request.method ?? 'GET'} ${route}`)
                }
            },
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
    ],
})

otelSdk.start()
