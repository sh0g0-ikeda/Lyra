import { SignJWT } from 'jose';

export interface CreateDevAuthTokenInput {
  jwtSecret: string;
  subject?: string;
  email?: string;
  expiresInHours?: number;
}

export interface CreatedDevAuthToken {
  token: string;
  subject: string;
  email: string;
  expiresInHours: number;
}

const DEFAULT_SUBJECT = 'dev-local-user';
const DEFAULT_EMAIL = 'dev@local.lyra';
const DEFAULT_EXPIRES_IN_HOURS = 12;

export async function createDevAuthToken(
  input: CreateDevAuthTokenInput,
): Promise<CreatedDevAuthToken> {
  const subject = input.subject ?? DEFAULT_SUBJECT;
  const email = input.email ?? DEFAULT_EMAIL;
  const expiresInHours = input.expiresInHours ?? DEFAULT_EXPIRES_IN_HOURS;

  if (input.jwtSecret.length === 0) {
    throw new Error('SUPABASE_JWT_SECRET is required');
  }
  if (subject.length === 0) {
    throw new Error('subject is required');
  }
  if (email.length === 0) {
    throw new Error('email is required');
  }
  if (!Number.isFinite(expiresInHours) || expiresInHours <= 0) {
    throw new Error('expiresInHours must be a positive number');
  }

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${expiresInHours}h`)
    .sign(new TextEncoder().encode(input.jwtSecret));

  return {
    token,
    subject,
    email,
    expiresInHours,
  };
}
