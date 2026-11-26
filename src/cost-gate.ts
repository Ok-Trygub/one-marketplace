import { readFileSync } from 'node:fs'
import { monthlyUsd } from './mapping'

const ALLOWED_GROWTH_USD = 10
const ALLOWED_GROWTH_SHARE = 0.2

const planPath = process.env.PLAN_JSON
const explicitBudget = process.env.COST_BUDGET_USD
const baseline = process.env.COST_BASELINE_USD

if (!planPath || (explicitBudget === undefined && baseline === undefined)) {
    console.error('usage: PLAN_JSON=<pulumi preview --json> COST_BUDGET_USD=<usd> | COST_BASELINE_USD=<usd> npm run gate:cost')
    process.exit(2)
}

const budget =
    explicitBudget !== undefined
        ? Number(explicitBudget)
        : Number(baseline) + Math.max(ALLOWED_GROWTH_USD, Number(baseline) * ALLOWED_GROWTH_SHARE)

if (!Number.isFinite(budget)) {
    console.error('the budget is not a number')
    process.exit(2)
}

const plan = monthlyUsd(JSON.parse(readFileSync(planPath, 'utf8')))
const pass = plan <= budget

console.log(`budget-usd=${budget.toFixed(2)}`)
console.log(`plan-usd=${plan.toFixed(2)}`)
console.log(`gate=${pass ? 'pass' : 'fail'}`)

process.exit(pass ? 0 : 1)
