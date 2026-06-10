import { env } from '../src/lib/env.js';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import { createDevAuthToken } from '../src/services/auth/DevAuthTokenService.js';

function readFlag(name: string): string | null {
  const prefix = `${name}=`;

  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith(prefix)) {
      return argument.slice(prefix.length);
    }
  }

  return null;
}

async function main(): Promise<void> {
  if (env.SUPABASE_JWT_SECRET === undefined) {
    throw new Error('SUPABASE_JWT_SECRET is not set');
  }

  const raw = process.argv.includes('--raw');
  const email = readFlag('--email') ?? undefined;
  const subject = readFlag('--subject') ?? undefined;
  const hoursFlag = readFlag('--hours');
  const expiresInHours = hoursFlag === null ? undefined : Number(hoursFlag);

  const result = await createDevAuthToken({
    jwtSecret: env.SUPABASE_JWT_SECRET,
    email,
    subject,
    expiresInHours,
  });

  if (raw) {
    console.log(result.token);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  const message = sanitizePersistedErrorMessage(error, 'Unknown error');
  console.error(message);
  process.exitCode = 1;
});
