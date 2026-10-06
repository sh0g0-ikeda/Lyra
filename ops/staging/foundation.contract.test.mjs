import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(new URL('./foundation.json', import.meta.url));
const template = JSON.parse(readFileSync(templatePath, 'utf8'));
const resources = template.Resources ?? {};
const serialized = JSON.stringify(template);

const resource = (name, type) => {
  assert.equal(resources[name]?.Type, type, `${name} must be ${type}`);
  return resources[name].Properties ?? {};
};

const containsGetAtt = (value, expected) => JSON.stringify(value).includes(JSON.stringify(expected));

// This foundation creates isolated network/data primitives only. Services, task
// definitions, and roles remain absent until the runtime stack owns them.
assert.equal(template.Parameters.ResourcePrefix.Default, 'lyra-staging-20261003');
assert.deepEqual(Object.keys(template.Parameters).filter(name => !name.startsWith('Google')).sort(), ['ExpiresAt', 'HostedZoneId', 'OriginHostname', 'ResourcePrefix']);
assert.equal(serialized.toLowerCase().includes('lyra-prod'), false, 'production identifiers are forbidden');
assert.equal(Object.values(resources).some(({ Type }) => Type === 'AWS::EC2::NatGateway'), false, 'NAT is forbidden');
assert.equal(Object.values(resources).some(({ Type }) => Type === 'AWS::ECS::Service'), false, 'services must start absent');
assert.equal(Object.values(resources).some(({ Type }) => Type === 'AWS::ECS::TaskDefinition'), false, 'task definitions belong to a later stack');
assert.equal(Object.values(resources).some(({ Type }) => String(Type).startsWith('AWS::IAM::')), false, 'roles belong to a later stack');
assert.match(template.Parameters.OriginHostname.AllowedPattern, /origin-staging/);

assert.equal(resource('StagingVpc', 'AWS::EC2::VPC').CidrBlock, '10.77.0.0/16');
for (const name of ['PublicSubnetA', 'PublicSubnetC', 'PrivateSubnetA', 'PrivateSubnetC']) {
  assert.equal(resources[name]?.Type, 'AWS::EC2::Subnet', `${name} must exist`);
}

const taskIngress = resource('TasksIngressFromAlb', 'AWS::EC2::SecurityGroupIngress') ? [resources.TasksIngressFromAlb.Properties] : [];
assert.equal(taskIngress.length, 1, 'tasks accept only ALB traffic');
assert.equal(taskIngress[0].FromPort, 3000);
assert.equal(containsGetAtt(taskIngress[0].SourceSecurityGroupId, ['AlbSecurityGroup', 'GroupId']), true);
for (const name of ['TasksIngressFromAlb', 'DatabaseIngressFromTasks', 'DatabaseIngressFromWorker']) {
  assert.equal(resources[name]?.Type, 'AWS::EC2::SecurityGroupIngress');
}
assert.equal(resources.DatabaseIngressFromTasks.Properties.FromPort, 5432);
assert.equal(resources.DatabaseIngressFromWorker.Properties.FromPort, 5432);
assert.equal(resource('WorkerSecurityGroup', 'AWS::EC2::SecurityGroup').SecurityGroupIngress, undefined);
const taskEgress = resources.TasksHttpsEgress.Properties;
assert.equal(taskEgress.ToPort, 443);
assert.equal(taskEgress.CidrIp, '0.0.0.0/0');
assert.deepEqual(resource('AlbSecurityGroup', 'AWS::EC2::SecurityGroup').SecurityGroupEgress, [{
  IpProtocol: 'tcp', FromPort: 3000, ToPort: 3000,
  DestinationSecurityGroupId: { 'Fn::GetAtt': ['TasksSecurityGroup', 'GroupId'] },
  Description: 'API tasks only',
}]);
assert.deepEqual(resource('DatabaseSecurityGroup', 'AWS::EC2::SecurityGroup').SecurityGroupEgress, [{
  IpProtocol: 'icmp', FromPort: 252, ToPort: 86, CidrIp: '255.255.255.255/32',
  Description: 'Disallow all traffic',
}]);

const database = resource('StagingDatabase', 'AWS::RDS::DBInstance');
assert.equal(database.Engine, 'postgres');
assert.equal(database.EngineVersion, '18.3');
assert.equal(database.DBInstanceClass, 'db.t4g.micro');
assert.equal(database.AllocatedStorage, '20');
assert.equal(database.StorageType, 'gp3');
assert.equal(database.PubliclyAccessible, false, 'database must remain private');
assert.equal(resources.StagingDatabase.DeletionPolicy, 'Snapshot');
assert.equal(resources.StagingKmsKey.DeletionPolicy, 'Retain');

for (const bucketName of ['StagingAssetsBucket', 'BuildSourceBucket']) {
  const bucket = resource(bucketName, 'AWS::S3::Bucket');
  assert.equal(bucket.PublicAccessBlockConfiguration.BlockPublicAcls, true);
}
assert.equal(resource('StagingAssetsBucket', 'AWS::S3::Bucket').VersioningConfiguration.Status, 'Enabled');
assert.equal(resource('BuildSourceBucket', 'AWS::S3::Bucket').VersioningConfiguration.Status, 'Enabled', 'immutable Lambda S3ObjectVersion requires source-bucket versioning');
assert.equal(resources.StagingAssetsBucket.DeletionPolicy, 'Retain');
assert.equal(resources.BuildSourceBucket.DeletionPolicy, 'Retain');
assert.equal(resource('BuildSourceBucket', 'AWS::S3::Bucket').BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
assert.equal(resource('BuildSourceBucket', 'AWS::S3::Bucket').LifecycleConfiguration.Rules[0].ExpirationInDays, 7);

for (const queue of ['GenerationQueue', 'ExportQueue']) {
  assert.equal(resource(queue, 'AWS::SQS::Queue').VisibilityTimeout, 1800);
  assert.equal(resources[queue].Properties.RedrivePolicy.maxReceiveCount, 5);
}

const targetGroup = resource('ApiTargetGroup', 'AWS::ElasticLoadBalancingV2::TargetGroup');
assert.equal(targetGroup.Port, 3000);
assert.equal(targetGroup.HealthCheckPath, '/readyz');
const listener = resource('HttpsListener', 'AWS::ElasticLoadBalancingV2::Listener');
assert.equal(listener.Port, 443);
assert.equal(listener.Protocol, 'HTTPS');
assert.equal(listener.SslPolicy, 'ELBSecurityPolicy-TLS13-1-2-2021-06');

const distribution = resource('StagingDistribution', 'AWS::CloudFront::Distribution').DistributionConfig;
assert.equal(distribution.ViewerCertificate.CloudFrontDefaultCertificate, true);
assert.equal(distribution.Origins[0].CustomOriginConfig.OriginProtocolPolicy, 'https-only');
assert.equal(distribution.Origins[0].OriginCustomHeaders[0].HeaderName, 'x-lyra-origin-verify');
assert.deepEqual(distribution.DefaultCacheBehavior.AllowedMethods, ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']);
assert.equal(distribution.DefaultCacheBehavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
assert.equal(distribution.DefaultCacheBehavior.OriginRequestPolicyId, 'b689b0a8-53d0-40ab-baf2-68738e2966ac');

const nativeClient = resource('NativeUserPoolClient', 'AWS::Cognito::UserPoolClient');
assert.deepEqual(nativeClient.CallbackURLs, ['lyra-mobile-staging://auth/mobile/callback']);
assert.deepEqual(nativeClient.LogoutURLs, ['lyra-mobile-staging://auth/mobile/logout']);
assert.deepEqual(resource('WebUserPoolClient', 'AWS::Cognito::UserPoolClient').CallbackURLs, [{ 'Fn::Sub': 'https://${StagingDistribution.DomainName}/auth/callback' }]);
assert.equal(resource('StagingUserPool', 'AWS::Cognito::UserPool').UsernameAttributes[0], 'email');
// Google explicit linking needs prompt=login, which classic hosted UI ignores.
assert.equal(resource('StagingUserPoolDomain', 'AWS::Cognito::UserPoolDomain').ManagedLoginVersion, 2);
for (const [branding, client] of [['NativeManagedLoginBranding', 'NativeUserPoolClient'], ['WebManagedLoginBranding', 'WebUserPoolClient']]) {
  assert.deepEqual(resource(branding, 'AWS::Cognito::ManagedLoginBranding'), {
    UserPoolId: { Ref: 'StagingUserPool' }, ClientId: { Ref: client }, UseCognitoProvidedValues: true,
  });
}

for (const output of ['VpcId', 'AlbDnsName', 'CloudFrontDomainName', 'DatabaseEndpoint', 'AssetsBucketName', 'BuildSourceBucketName', 'GenerationQueueArn', 'ExportQueueArn', 'GenerationQueueUrl', 'ExportQueueUrl', 'EcrRepositoryUri', 'TasksSecurityGroupId', 'WorkerSecurityGroupId', 'DatabaseSecurityGroupId', 'ApiLogGroupName', 'WorkerLogGroupName', 'UserPoolId', 'NativeUserPoolClientId', 'WebUserPoolClientId']) {
  assert.ok(template.Outputs[output], `${output} output must exist`);
}


// Named resources make IAM boundaries independent of generated physical IDs.
assert.deepEqual(resources.ApplicationLoadBalancer.Properties.Name, { 'Fn::Sub': '${ResourcePrefix}-alb' });
assert.deepEqual(resources.ApiTargetGroup.Properties.Name, { 'Fn::Sub': '${ResourcePrefix}-api' });
assert.deepEqual(resources.StagingDatabase.Properties.DBInstanceIdentifier, { 'Fn::Sub': '${ResourcePrefix}-db' });
assert.deepEqual(resources.DatabaseCredentials.Properties.Name, { 'Fn::Sub': '${ResourcePrefix}-db' });
assert.deepEqual(resources.OriginVerificationSecret.Properties.Name, { 'Fn::Sub': '${ResourcePrefix}-origin' });
assert.deepEqual(resources.DatabaseSubnetGroup.Properties.DBSubnetGroupName, { 'Fn::Sub': '${ResourcePrefix}-db' });
assert.deepEqual(resources.GenerationQueue.Properties.QueueName, { 'Fn::Sub': '${ResourcePrefix}-generation' });
assert.deepEqual(resources.GenerationDlq.Properties.QueueName, { 'Fn::Sub': '${ResourcePrefix}-generation-dlq' });
assert.deepEqual(resources.ExportQueue.Properties.QueueName, { 'Fn::Sub': '${ResourcePrefix}-export' });
assert.deepEqual(resources.ExportDlq.Properties.QueueName, { 'Fn::Sub': '${ResourcePrefix}-export-dlq' });
assert.deepEqual(resources.ApiLogGroup.Properties.LogGroupName, { 'Fn::Sub': '/lyra/${ResourcePrefix}/api' });
assert.deepEqual(resources.WorkerLogGroup.Properties.LogGroupName, { 'Fn::Sub': '/lyra/${ResourcePrefix}/worker' });
assert.deepEqual(resources.StagingAssetsBucket.Properties.BucketName, { 'Fn::Sub': '${ResourcePrefix}-images-${AWS::AccountId}' });

for (const r of Object.values(resources)) {
  const p=r.Properties;
  if (Array.isArray(p?.Tags)) assert.ok(p.Tags.some(t => (t.Key ?? t.TagKey) === "LyraStagingId"));
  if (p?.UserPoolTags) assert.deepEqual(p.UserPoolTags.LyraStagingId, {Ref:"ResourcePrefix"});
}


for (const r of Object.values(resources)) for (const tag of r.Properties?.Tags ?? []) assert.ok(typeof tag.Key === "string" && tag.Value !== undefined, "CloudFormation tags use Key/Value");
for (const r of Object.values(resources)) { const g=r.Properties?.GenerateSecretString; if (g?.GenerateStringKey && g.SecretStringTemplate) assert.equal(Object.hasOwn(JSON.parse(g.SecretStringTemplate), g.GenerateStringKey), false, "Generated secret key must not exist in template"); }

assert.equal(resource("ContainerRepository", "AWS::ECR::Repository").EmptyOnDelete, true, "staging expiry must delete a populated owned repository");

console.log(`foundation contract passed (${Object.keys(resources).length} resources)`);
