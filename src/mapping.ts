export const HOURS_PER_MONTH = 730
export const VCPU_HOUR_USD = 0.04656
export const GIB_HOUR_USD = 0.00511

type Container = { resources?: { requests?: { cpu?: string | number; memory?: string | number } } }

type PlanStep = {
    op?: string
    newState?: {
        type?: string
        inputs?: {
            spec?: { replicas?: number; template?: { spec?: { containers?: Container[] } } }
        }
    }
}

export type Plan = { steps?: PlanStep[] }

const WORKLOAD_TYPES = new Set(['kubernetes:apps/v1:Deployment', 'kubernetes:apps/v1:StatefulSet'])

const MEMORY_UNITS: Record<string, number> = {
    '': 1 / 1024 ** 3,
    Ki: 1 / 1024 ** 2,
    Mi: 1 / 1024,
    Gi: 1,
    Ti: 1024,
    k: 1e3 / 1024 ** 3,
    M: 1e6 / 1024 ** 3,
    G: 1e9 / 1024 ** 3,
}

export const vcpuOf = (value: string | number | undefined): number => {
    if (value === undefined) return 0
    const text = String(value)

    return text.endsWith('m') ? Number(text.slice(0, -1)) / 1000 : Number(text)
}

export const gibOf = (value: string | number | undefined): number => {
    if (value === undefined) return 0
    const match = /^([0-9.]+)([A-Za-z]*)$/.exec(String(value))
    const factor = match ? MEMORY_UNITS[match[2]] : undefined

    if (!match || factor === undefined) {
        throw new Error(`unsupported memory quantity ${value}`)
    }

    return Number(match[1]) * factor
}

export const monthlyUsd = (plan: Plan): number =>
    (plan.steps ?? [])
        .filter((step) => step.op !== 'delete' && WORKLOAD_TYPES.has(step.newState?.type ?? ''))
        .reduce((total, step) => {
            const spec = step.newState?.inputs?.spec
            const replicas = spec?.replicas ?? 1
            const hourly = (spec?.template?.spec?.containers ?? []).reduce(
                (sum, container) =>
                    sum +
                    vcpuOf(container.resources?.requests?.cpu) * VCPU_HOUR_USD +
                    gibOf(container.resources?.requests?.memory) * GIB_HOUR_USD,
                0,
            )

            return total + replicas * hourly * HOURS_PER_MONTH
        }, 0)
