const required = ['ECR_REPOSITORY_URI', 'IMAGE_TAG', 'STAGING_API_URL', 'STAGING_COGNITO_DOMAIN', 'STAGING_WEB_CLIENT_ID'];
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = '452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-staging-20261003-api';
const apiOrigin = 'https://d2dw83tkmziksr.cloudfront.net';
const cognitoDomain = 'https://lyra-staging-20261003-auth.auth.ap-northeast-1.amazoncognito.com';
const webClientId = '7oma7s7gkoo5au4jk4ak9mkihd';

export function validateBuildEnvironment(env) {
  for (const key of required) if (!env[key]?.trim()) throw new Error(`${key} is required`);
  if (env.ECR_REPOSITORY_URI !== repository) throw new Error('ECR repository is not the staging repository');
  if (!/^[a-f0-9]{40}$/u.test(env.IMAGE_TAG)) throw new Error('IMAGE_TAG must be an immutable commit SHA');
  if (env.STAGING_API_URL !== apiOrigin) throw new Error('STAGING_API_URL is not the staging CloudFront origin');
  if (env.STAGING_COGNITO_DOMAIN !== cognitoDomain) throw new Error('STAGING_COGNITO_DOMAIN is not the staging Cognito domain');
  if (env.STAGING_WEB_CLIENT_ID !== webClientId) throw new Error('STAGING_WEB_CLIENT_ID is not the staging web client');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) validateBuildEnvironment(process.env);
