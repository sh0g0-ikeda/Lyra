import { pathToFileURL } from 'node:url';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { auditIdentitySubjects, type AuditedPoolIdentity } from '../src/services/auth/IdentitySubjectAudit.js';

const MAX_POOL_PAGES = 1_000;
const POOL_READ_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('No arguments accepted');
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();
  const { env } = await import('../src/lib/env.js');
  const { db, closeDatabasePool } = await import('../src/lib/db.js');
  try {
    if (env.AUTH_PROVIDER !== 'cognito' || !env.COGNITO_USER_POOL_ID || !env.AWS_REGION) {
      throw new Error('Cognito audit is not configured');
    }
    const client = new CognitoIdentityProviderClient({ region: env.AWS_REGION, maxAttempts: 1 });
    const report = await auditIdentitySubjects(db, async () => {
      const identities: AuditedPoolIdentity[] = [];
      let token: string | undefined;
      const signal = AbortSignal.timeout(POOL_READ_TIMEOUT_MS);
      for (let page = 0; page < MAX_POOL_PAGES; page++) {
        const result = await client.send(new ListUsersCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Limit: 60,
          ...(token ? { PaginationToken: token } : {}),
        }), { abortSignal: signal });
        for (const user of result.Users ?? []) {
          const attrs = new Map((user.Attributes ?? []).map((attribute) => [attribute.Name, attribute.Value]));
          identities.push({
            subject: attrs.get('sub') ?? '',
            email: attrs.get('email') ?? null,
            enabled: user.Enabled === true,
          });
        }
        token = result.PaginationToken;
        if (!token) return { identities, limitReached: false };
      }
      return { identities, limitReached: true };
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready_for_subject_only_login) process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('Identity subject audit failed; no account or credential details are emitted');
    process.exitCode = 1;
  });
}
