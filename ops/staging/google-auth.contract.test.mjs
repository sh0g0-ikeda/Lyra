import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const foundation=read('./foundation.json'),runtime=read('./runtime.json');
function resolve(value, conditions){
 if(Array.isArray(value)) return value.map(v=>resolve(v,conditions));
 if(!value||typeof value!=='object') return value;
 if(Object.hasOwn(value,'Fn::If')){const[c,yes,no]=value['Fn::If'];return resolve(conditions[c]?yes:no,conditions);}
 const result={};for(const[k,v]of Object.entries(value)){const r=resolve(v,conditions);if(r?.Ref!=='AWS::NoValue')result[k]=r;}return result;
}
test('Googleの既定設定では既存メール認証と両クライアントが維持される',()=>{
 for(const p of ['GoogleCollisionGuardEnabled','GoogleIdentityProviderEnabled'])assert.equal(foundation.Parameters[p]?.Default,'false');
 const off={GoogleGuardConfigured:false,GoogleProviderConfigured:false};
 const pool=resolve(foundation.Resources.StagingUserPool.Properties,off);assert.equal(pool.LambdaConfig,undefined);
 for(const name of ['NativeUserPoolClient','WebUserPoolClient']){
  const c=resolve(foundation.Resources[name].Properties,off);
  assert.deepEqual(c.SupportedIdentityProviders,['COGNITO']);assert.deepEqual(c.AllowedOAuthFlows,['code']);
  assert.deepEqual(c.AllowedOAuthScopes,['openid','email','profile']);assert.equal(c.GenerateSecret,false);assert.equal(c.PreventUserExistenceErrors,'ENABLED');
 }
 assert.deepEqual(resolve(foundation.Resources.NativeUserPoolClient.Properties,off).CallbackURLs,['lyra-mobile-staging://auth/mobile/callback']);
 assert.deepEqual(resolve(foundation.Resources.WebUserPoolClient.Properties,off).CallbackURLs,[{'Fn::Sub':'https://${StagingDistribution.DomainName}/auth/callback'}]);
 assert.equal(runtime.Parameters.GoogleIdentityLinkGrantEnabled?.Default,'false');
});
test('providerを有効にする場合は先行するguardと空でない限定ARNが必要になる',()=>{
 assert.deepEqual(foundation.Rules.GoogleProviderRequiresGuard.RuleCondition,{'Fn::Equals':[{Ref:'GoogleIdentityProviderEnabled'},'true']});
 assert.deepEqual(foundation.Rules.GoogleProviderRequiresGuard.Assertions[0].Assert,{'Fn::Equals':[{Ref:'GoogleCollisionGuardEnabled'},'true']});
 for(const[param,rule]of [['GooglePreSignUpArn','GoogleGuardRequiresArn'],['GoogleOAuthSecretArn','GoogleProviderRequiresSecret']]){
  assert.equal(foundation.Parameters[param].Default,'');assert.match(foundation.Parameters[param].AllowedPattern,/lyra-staging/);
  assert.deepEqual(foundation.Rules[rule].Assertions[0].Assert,{'Fn::Not':[{'Fn::Equals':[{Ref:param},'']}]});
 }
 assert.deepEqual(foundation.Conditions.GoogleGuardConfigured,{'Fn::Equals':[{Ref:'GoogleCollisionGuardEnabled'},'true']});
 assert.deepEqual(foundation.Conditions.GoogleProviderConfigured,{'Fn::Equals':[{Ref:'GoogleIdentityProviderEnabled'},'true']});
});
test('Googleを解除しても衝突ガードを先に外さずメール認証に戻せる',()=>{
 const rollback={GoogleGuardConfigured:true,GoogleProviderConfigured:false};
 assert.deepEqual(resolve(foundation.Resources.StagingUserPool.Properties,rollback).LambdaConfig,{PreSignUp:{Ref:'GooglePreSignUpArn'}});
 for(const name of ['NativeUserPoolClient','WebUserPoolClient'])assert.deepEqual(resolve(foundation.Resources[name].Properties,rollback).SupportedIdentityProviders,['COGNITO']);
});
test('Google接続では専用secretとverified-emailを使い既存メールproviderを残す',()=>{
 const idp=foundation.Resources.GoogleIdentityProvider;assert.equal(idp.Type,'AWS::Cognito::UserPoolIdentityProvider');assert.equal(idp.Condition,'GoogleProviderConfigured');
 const p=idp.Properties;assert.equal(p.ProviderName,'Google');assert.equal(p.ProviderType,'Google');assert.deepEqual(p.UserPoolId,{Ref:'StagingUserPool'});
 assert.equal(p.ProviderDetails.authorize_scopes,'openid email');
 for(const key of ['client_id','client_secret'])assert.deepEqual(p.ProviderDetails[key],{'Fn::Sub':'{{resolve:secretsmanager:${GoogleOAuthSecretArn}:SecretString:'+key+'}}'});
 assert.deepEqual(p.AttributeMapping,{email:'email',email_verified:'email_verified'});
 const on={GoogleGuardConfigured:true,GoogleProviderConfigured:true};
 for(const name of ['NativeUserPoolClient','WebUserPoolClient'])assert.deepEqual(resolve(foundation.Resources[name].Properties,on).SupportedIdentityProviders,['COGNITO',{Ref:'GoogleIdentityProvider'}]);
});
test('APIのGoogle連携権限は検証poolの読取と明示連携だけになる',()=>{
 const grant=runtime.Resources.GoogleIdentityLinkGrant;assert.equal(grant.Condition,'GoogleLinkGrantConfigured');assert.equal(grant.Type,'AWS::IAM::Policy');
 assert.deepEqual(grant.Properties.Roles,[{Ref:'ApiTaskRole'}]);
 assert.deepEqual(grant.Properties.PolicyDocument.Statement,[{Sid:'ExplicitGoogleLinkInExactStagePool',Effect:'Allow',Action:['cognito-idp:AdminGetUser','cognito-idp:AdminLinkProviderForUser'],Resource:{'Fn::Sub':'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${GoogleUserPoolId}'}}]);
 assert.deepEqual(runtime.Rules.GoogleLinkGrantRequiresPool.Assertions[0].Assert,{'Fn::Not':[{'Fn::Equals':[{Ref:'GoogleUserPoolId'},'']}]});
 assert.equal(JSON.stringify(grant).includes('AdminDelete'),false);assert.equal(JSON.stringify(grant).includes('RuntimeSecret'),false);
});

test('別環境のpoolやguardやsecretを指定した場合は設定契約が拒否する',()=>{
 assert.deepEqual(runtime.Parameters.GoogleUserPoolId.AllowedValues,['','ap-northeast-1_qZM5rxoco']);
 assert.equal(runtime.Parameters.GoogleUserPoolId.AllowedValues.includes('ap-northeast-1_wiZLzlGMM'),false);
 const guard=new RegExp(foundation.Parameters.GooglePreSignUpArn.AllowedPattern);
 assert.equal(guard.test('arn:aws:lambda:ap-northeast-1:452284481392:function:lyra-staging-20261003-google-presignup'),true);
 assert.equal(guard.test('arn:aws:lambda:ap-northeast-1:452284481392:function:lyra-staging-other-google-presignup'),false);
 const secret=new RegExp(foundation.Parameters.GoogleOAuthSecretArn.AllowedPattern);
 assert.equal(secret.test('arn:aws:secretsmanager:ap-northeast-1:452284481392:secret:lyra-staging-20261003-google-oauth-a1b2C3'),true);
 assert.equal(secret.test('arn:aws:secretsmanager:ap-northeast-1:452284481392:secret:lyra-staging-other-google-oauth-a1b2C3'),false);
});
