import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Env } from '../../lib/env.js';
import type { DatabaseClient } from '../../lib/db.js';
import { assertVerifiedRuntimeProof, type AttestedRuntime } from '../../lib/runtimeSchemaAttestation.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { PostgresXOidcArtifactRepository } from '../../repositories/XOidcArtifactRepository.js';
import { XOidcService } from '../../services/auth/XOidcService.js';
import { XOidcCrypto } from './XOidcCrypto.js';
import { XOAuthGateway } from './XOAuthGateway.js';
import { resolveXOidcConfig } from './XOidcConfig.js';
import { assertXCognitoProfileAllowed } from './XCognitoIdentityGuard.js';

export function createXOidcRuntime(env: Env, database: DatabaseClient, runtime?: AttestedRuntime): XOidcService {
  const config = resolveXOidcConfig(env);
  if (!config) return XOidcService.disabled();
  if (!runtime) throw new ConfigurationError('X sign-in requires a verified X OIDC database capability');
  assertVerifiedRuntimeProof(runtime);
  if (!runtime.capabilities.xOidc) throw new ConfigurationError('X sign-in requires migration 052');
  const cognito = new CognitoIdentityProviderClient({ region: config.region, maxAttempts: 1 });
  const ses = new SESv2Client({ region: config.region, maxAttempts: 1 });
  return new XOidcService(config.service, {
    repository: new PostgresXOidcArtifactRepository(database),
    oauth: new XOAuthGateway(config.oauth), crypto: new XOidcCrypto(config.crypto),
    assertProfileAllowed: profile => assertXCognitoProfileAllowed(cognito, config.userPoolId, profile),
    sendCode: async (email, code) => {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: config.fromEmail, Destination: { ToAddresses: [email] },
        Content: { Simple: { Subject: { Data: 'Lyra — Xログイン確認コード / X sign-in code', Charset: 'UTF-8' }, Body: { Text: { Data: `LyraのXログイン確認コード: ${code}\nX sign-in verification code: ${code}\n\n4分以内に入力してください。心当たりがなければ、このメールを無視してください。\nEnter within four minutes. If you did not request this, ignore this email.`, Charset: 'UTF-8' } } } },
      }), { abortSignal: AbortSignal.timeout(8000) });
    },
  });
}
