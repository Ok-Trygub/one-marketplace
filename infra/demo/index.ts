import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

pulumi.runtime.registerResourceTransform((args) =>
    args.type === 'aws:rds/instance:Instance'
        ? { props: { ...args.props, deletionProtection: false, skipFinalSnapshot: true }, opts: args.opts }
        : undefined,
)

const dbPassword = process.env.DEMO_DB_PASSWORD

if (!dbPassword) {
    throw new Error('Missing required environment variable: DEMO_DB_PASSWORD')
}

const config = new pulumi.Config()
const withNat = new pulumi.Config('hw31').getBoolean('withNat') ?? false
const base = new pulumi.StackReference(config.require('baseStack'))

const publicSubnetIds = base.requireOutput('publicSubnetIds') as pulumi.Output<string[]>
const privateSubnetIds = base.requireOutput('privateSubnetIds') as pulumi.Output<string[]>
const vpcId = base.requireOutput('vpcId') as pulumi.Output<string>

const dbSubnets = new aws.rds.SubnetGroup('postgres', { subnetIds: privateSubnetIds })

const database = new aws.rds.Instance('postgres', {
    engine: 'postgres',
    engineVersion: '17',
    instanceClass: 'db.t4g.micro',
    multiAz: true,
    allocatedStorage: 20,
    storageType: 'gp3',
    storageEncrypted: true,
    backupRetentionPeriod: 1,
    dbName: 'marketplace',
    username: 'app_user',
    password: pulumi.secret(dbPassword),
    dbSubnetGroupName: dbSubnets.name,
    vpcSecurityGroupIds: [base.requireOutput('dbSecurityGroupId') as pulumi.Output<string>],
    publiclyAccessible: false,
    performanceInsightsEnabled: false,
    monitoringInterval: 0,
    applyImmediately: true,
    deletionProtection: false,
    skipFinalSnapshot: true,
})

const targetRole = new aws.iam.Role('alb-target', {
    assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    }),
})

new aws.iam.RolePolicyAttachment('alb-target-logs', {
    role: targetRole.name,
    policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
})

const targetGroup = new aws.lb.TargetGroup('api', {
    targetType: 'lambda',
    healthCheck: { enabled: true, path: '/', interval: 30, timeout: 5, healthyThreshold: 2, unhealthyThreshold: 2, matcher: '200' },
})

const target = new aws.lambda.Function('alb-target', {
    runtime: 'nodejs22.x',
    handler: 'index.handler',
    role: targetRole.arn,
    code: new pulumi.asset.AssetArchive({
        'index.js': new pulumi.asset.StringAsset(
            "exports.handler = async () => ({ statusCode: 200, statusDescription: '200 OK', isBase64Encoded: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ok' }) })",
        ),
    }),
}, { dependsOn: [targetGroup] })

const loadBalancer = new aws.lb.LoadBalancer('api', {
    loadBalancerType: 'application',
    internal: false,
    subnets: publicSubnetIds,
    securityGroups: [base.requireOutput('albSecurityGroupId') as pulumi.Output<string>],
})


const invokeFromAlb = new aws.lambda.Permission('alb-invoke', {
    action: 'lambda:InvokeFunction',
    function: target.name,
    principal: 'elasticloadbalancing.amazonaws.com',
    sourceArn: targetGroup.arn,
})

new aws.lb.TargetGroupAttachment('api', { targetGroupArn: targetGroup.arn, targetId: target.arn }, { dependsOn: [invokeFromAlb] })

new aws.lb.Listener('http', {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    protocol: 'HTTP',
    defaultActions: [{ type: 'forward', targetGroupArn: targetGroup.arn }],
})

const nat = withNat
    ? new aws.ec2.NatGateway('measured', {
          subnetId: publicSubnetIds.apply((ids) => ids[0]),
          allocationId: new aws.ec2.Eip('nat', { domain: 'vpc' }).id,
          connectivityType: 'public',
      })
    : undefined

export const vpc = vpcId
export const dbInstanceId = database.identifier
export const albDnsName = loadBalancer.dnsName
export const targetGroupArn = targetGroup.arn
export const natGatewayId = nat ? nat.id : null
