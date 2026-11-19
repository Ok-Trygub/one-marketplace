import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'

const SECRET_ENV = [
    'DATABASE_URL',
    'BROKER_URL',
    'REDIS_URL',
    'REDIS_QUEUE_URL',
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEY',
    'JWT_KID',
    'REFRESH_TOKEN_PEPPER',
    'STORAGE_ENDPOINT',
    'STORAGE_REGION',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
    'STORAGE_BUCKET',
] as const

const missing = SECRET_ENV.filter((name) => !process.env[name])

if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

const config = new pulumi.Config()
const namespaceName = config.require('namespace')
const image = config.require('image')
const replicas = config.requireNumber('replicas')
const nodePort = config.requireNumber('nodePort')
const dependencies = config.requireObject<Record<string, string>>('dependencies')

const APP_PORT = 5001
const STARTUP_DELAY_MS = 4000
const SHUTDOWN_DRAIN_MS = 10000
const TERMINATION_GRACE_SECONDS = 25
const labels = { app: 'marketplace-api' }

const reachableFromCluster = (name: string, raw: string): string => {
    const url = new URL(raw)

    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        return raw
    }

    const target = dependencies[url.port]

    if (!target) {
        throw new Error(`${name} points to port ${url.port} on this machine, add it to the dependencies config`)
    }

    url.host = target

    return url.toString().replace(/\/$/, '')
}

const HOST_URLS = new Set(['DATABASE_URL', 'BROKER_URL', 'REDIS_URL', 'REDIS_QUEUE_URL', 'STORAGE_ENDPOINT'])

const secretValues = Object.fromEntries(
    SECRET_ENV.map((name) => {
        const value = process.env[name] as string

        return [name, Buffer.from(HOST_URLS.has(name) ? reachableFromCluster(name, value) : value).toString('base64')]
    }),
)

const provider = new k8s.Provider('kind', { context: config.require('kubeContext') })
const options = { provider }

const namespace = new k8s.core.v1.Namespace('namespace', { metadata: { name: namespaceName } }, options)

const secret = new k8s.core.v1.Secret(
    'api-env',
    {
        metadata: { name: 'marketplace-api-env', namespace: namespace.metadata.name },
        type: 'Opaque',
        data: pulumi.secret(secretValues),
    },
    options,
)

const deployment = new k8s.apps.v1.Deployment(
    'api',
    {
        metadata: { name: 'marketplace-api', namespace: namespace.metadata.name, labels },
        spec: {
            replicas,
            selector: { matchLabels: labels },
            strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
            template: {
                metadata: { labels },
                spec: {
                    terminationGracePeriodSeconds: TERMINATION_GRACE_SECONDS,
                    securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532 },
                    containers: [
                        {
                            name: 'api',
                            image,
                            imagePullPolicy: 'IfNotPresent',
                            ports: [{ name: 'http', containerPort: APP_PORT }],
                            envFrom: [{ secretRef: { name: secret.metadata.name } }],
                            env: [
                                { name: 'PORT', value: String(APP_PORT) },
                                { name: 'STARTUP_DELAY_MS', value: String(STARTUP_DELAY_MS) },
                                { name: 'SHUTDOWN_DRAIN_MS', value: String(SHUTDOWN_DRAIN_MS) },
                                { name: 'REV', value: config.get('rev') ?? '1' },
                            ],
                            readinessProbe: {
                                httpGet: { path: '/readyz', port: 'http' },
                                periodSeconds: 1,
                                timeoutSeconds: 3,
                                failureThreshold: 3,
                            },
                            livenessProbe: {
                                httpGet: { path: '/healthz', port: 'http' },
                                periodSeconds: 10,
                                timeoutSeconds: 5,
                                failureThreshold: 6,
                            },
                            resources: {
                                requests: { cpu: '100m', memory: '128Mi' },
                                limits: { memory: '384Mi' },
                            },
                            securityContext: { allowPrivilegeEscalation: false },
                        },
                    ],
                },
            },
        },
    },
    options,
)

const service = new k8s.core.v1.Service(
    'api',
    {
        metadata: { name: 'marketplace-api', namespace: namespace.metadata.name },
        spec: {
            type: 'NodePort',
            selector: labels,
            ports: [{ name: 'http', port: APP_PORT, targetPort: 'http', nodePort }],
        },
    },
    options,
)

const pdb = new k8s.policy.v1.PodDisruptionBudget(
    'api',
    {
        metadata: { name: 'marketplace-api', namespace: namespace.metadata.name },
        spec: { minAvailable: replicas - 1, selector: { matchLabels: labels } },
    },
    options,
)

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
    'api',
    {
        metadata: { name: 'marketplace-api', namespace: namespace.metadata.name },
        spec: {
            scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name },
            minReplicas: replicas,
            maxReplicas: replicas + 2,
            metrics: [
                {
                    type: 'Resource',
                    resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
                },
            ],
        },
    },
    options,
)

export const namespaceOutput = namespace.metadata.name
export const deploymentName = deployment.metadata.name
export const serviceNodePort = service.spec.ports[0].nodePort
export const pdbName = pdb.metadata.name
export const hpaName = hpa.metadata.name
