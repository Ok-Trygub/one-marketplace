import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const config = new pulumi.Config()
const withBudget = config.getBoolean('withBudget') ?? true
const githubRepository = config.require('githubRepository')
const [githubOwner, githubRepositoryName] = githubRepository.split('/')
const vpcCidr = config.require('vpcCidr')


const budget = withBudget
    ? new aws.budgets.Budget('monthly-cost', {
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          limitAmount: '5',
          limitUnit: 'USD',
          notifications: [
              {
                  notificationType: 'ACTUAL',
                  comparisonOperator: 'GREATER_THAN',
                  threshold: 20,
                  thresholdType: 'PERCENTAGE',
                  subscriberEmailAddresses: [config.require('budgetAlertEmail')],
              },
          ],
      })
    : undefined

const afterBudget = { dependsOn: budget ? [budget] : [] }

const zones = aws.getAvailabilityZonesOutput({ state: 'available' }).names.apply((names) => names.slice(0, 2))

const vpc = new aws.ec2.Vpc('vpc', { cidrBlock: vpcCidr, enableDnsHostnames: true, enableDnsSupport: true }, afterBudget)

const subnet = (name: string, index: number, cidr: string, isPublic: boolean) =>
    new aws.ec2.Subnet(name, {
        vpcId: vpc.id,
        cidrBlock: cidr,
        availabilityZone: zones.apply((names) => names[index]),
        mapPublicIpOnLaunch: isPublic,
        tags: { Tier: isPublic ? 'public' : 'private' },
    })

const publicSubnets = [subnet('public-a', 0, '10.31.0.0/24', true), subnet('public-b', 1, '10.31.1.0/24', true)]
const privateSubnets = [subnet('private-a', 0, '10.31.10.0/24', false), subnet('private-b', 1, '10.31.11.0/24', false)]

const internetGateway = new aws.ec2.InternetGateway('igw', { vpcId: vpc.id })

const publicRouteTable = new aws.ec2.RouteTable('public-routes', {
    vpcId: vpc.id,
    routes: [{ cidrBlock: '0.0.0.0/0', gatewayId: internetGateway.id }],
})

const privateRouteTable = new aws.ec2.RouteTable('private-routes', { vpcId: vpc.id })

publicSubnets.forEach((item, index) =>
    new aws.ec2.RouteTableAssociation(`public-routes-${index}`, { subnetId: item.id, routeTableId: publicRouteTable.id }),
)
privateSubnets.forEach((item, index) =>
    new aws.ec2.RouteTableAssociation(`private-routes-${index}`, { subnetId: item.id, routeTableId: privateRouteTable.id }),
)

const albSecurityGroup = new aws.ec2.SecurityGroup('alb', {
    vpcId: vpc.id,
    description: 'Public ALB of the demo stack',
    ingress: [{ protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'], description: 'HTTP from the internet, the ALB is the only public entry point' }],
    egress: [{ protocol: 'tcp', fromPort: 5001, toPort: 5001, cidrBlocks: [vpcCidr], description: 'API port of the targets inside the VPC' }],
})

const appSecurityGroup = new aws.ec2.SecurityGroup('app', {
    vpcId: vpc.id,
    description: 'API targets behind the ALB',
    ingress: [{ protocol: 'tcp', fromPort: 5001, toPort: 5001, securityGroups: [albSecurityGroup.id], description: 'API port, reachable only from the ALB' }],
    egress: [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, cidrBlocks: [vpcCidr], description: 'PostgreSQL in the private subnets' }],
})

const dbSecurityGroup = new aws.ec2.SecurityGroup('db', {
    vpcId: vpc.id,
    description: 'RDS PostgreSQL in the private subnets',
    ingress: [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, securityGroups: [appSecurityGroup.id], description: 'PostgreSQL, reachable only from the API targets' }],
})

const githubOidc = new aws.iam.OpenIdConnectProvider('github-actions', {
    url: 'https://token.actions.githubusercontent.com',
    clientIdLists: ['sts.amazonaws.com'],
})

const teardownRole = new aws.iam.Role('teardown', {
    name: 'hw31-teardown',
    assumeRolePolicy: githubOidc.arn.apply((providerArn) =>
        JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { Federated: providerArn },
                    Action: 'sts:AssumeRoleWithWebIdentity',
                    Condition: {
                        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
                        StringLike: {
                            'token.actions.githubusercontent.com:sub': [
                                `repo:${githubRepository}:*`,
                                `repo:${githubOwner}@*/${githubRepositoryName}@*:*`,
                            ],
                        },
                    },
                },
            ],
        }),
    ),
})

const TEARDOWN_ACTIONS = [
    'rds:DescribeDBInstances',
    'rds:DeleteDBInstance',
    'rds:DescribeDBSubnetGroups',
    'rds:DeleteDBSubnetGroup',
    'rds:ListTagsForResource',
    'elasticloadbalancing:DescribeLoadBalancers',
    'elasticloadbalancing:DeleteLoadBalancer',
    'elasticloadbalancing:DescribeListeners',
    'elasticloadbalancing:DeleteListener',
    'elasticloadbalancing:DescribeTargetGroups',
    'elasticloadbalancing:DeleteTargetGroup',
    'elasticloadbalancing:DescribeTargetHealth',
    'elasticloadbalancing:DeregisterTargets',
    'elasticloadbalancing:DescribeTags',
    'ec2:DescribeNatGateways',
    'ec2:DeleteNatGateway',
    'ec2:DescribeAddresses',
    'ec2:ReleaseAddress',
    'ec2:DisassociateAddress',
    'lambda:GetFunction',
    'lambda:DeleteFunction',
    'lambda:RemovePermission',
    'iam:GetRole',
    'iam:DeleteRole',
    'iam:ListAttachedRolePolicies',
    'iam:DetachRolePolicy',
    'tag:GetResources',
]

const teardownPolicy = new aws.iam.Policy('teardown', {
    name: 'hw31-teardown-demo-stack',
    policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: TEARDOWN_ACTIONS, Resource: '*' }],
    }),
})

new aws.iam.RolePolicyAttachment('teardown', { role: teardownRole.name, policyArn: teardownPolicy.arn })

export const budgetCreated = Boolean(budget)
export const vpcId = vpc.id
export const publicSubnetIds = publicSubnets.map((item) => item.id)
export const privateSubnetIds = privateSubnets.map((item) => item.id)
export const publicRouteTableId = publicRouteTable.id
export const privateRouteTableId = privateRouteTable.id
export const albSecurityGroupId = albSecurityGroup.id
export const appSecurityGroupId = appSecurityGroup.id
export const dbSecurityGroupId = dbSecurityGroup.id
export const teardownRoleArn = teardownRole.arn
export const teardownPolicyArn = teardownPolicy.arn
