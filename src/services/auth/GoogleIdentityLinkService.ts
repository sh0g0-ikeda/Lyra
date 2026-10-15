import { randomUUID } from 'node:crypto';
import { AppError, NotFoundError } from '../../domain/errors/index.js';
import { createGoogleLinkMaterial, decryptGoogleLinkMaterial, encryptGoogleLinkMaterial, googleLinkAuthorizationUrl, googleLinkHash, secureHashEquals, GOOGLE_LINK_RECENT_AUTH_SECONDS, GOOGLE_LINK_TTL_MS } from '../../domain/auth/GoogleLinkProtocol.js';
import type { GoogleLinkChallenge, GoogleLinkReceipt, GoogleLinkStartResponse, VerifiedCognitoIdentity } from '../../domain/types/googleIdentityLink.js';
import type { AuthenticatedUser } from '../../domain/types/user.js';
import type { GoogleIdentityLinkRepository } from '../../repositories/GoogleIdentityLinkRepository.js';
export interface GoogleLinkConfig {
    clientId: string;
    redirectUri: string;
    webReturnUri: string;
    nativeReturnUri: string;
    encryptionSecret: string;
    sourceRecoveryEnabled?: boolean;
}
export interface NativeCognitoIdentity {
    subject: string;
    email: string;
    enabled: boolean;
    status: string;
    googleSubjects: string[];
}
export interface GoogleCognitoProfile {
    username: string;
    subject: string;
    email: string;
    googleSubject: string;
}
export interface GoogleIdentityLinkGateway {
    getGoogleProfile(googleSubject: string): Promise<GoogleCognitoProfile | null>;
    deleteGoogleProfile(profile: GoogleCognitoProfile): Promise<void>;
    getNativeIdentity(username: string): Promise<NativeCognitoIdentity>;
    exchangeCode(input: {
        code: string;
        verifier: string;
        nonce: string;
    }): Promise<{
        subject: string;
        email: string;
    }>;
    linkGoogleIdentity(nativeUsername: string, googleSubject: string): Promise<void>;
}
export interface GoogleIdentityLinkServicePort {
    readonly enabled: boolean;
    start(user: AuthenticatedUser, proof: VerifiedCognitoIdentity | null, input: {
        platform: 'mobile' | 'web';
        request_key: string;
    }): Promise<GoogleLinkStartResponse>;
    status(user: AuthenticatedUser, id: string): Promise<GoogleLinkReceipt>;
    callback(input: {
        state: string;
        code?: string;
        error?: string;
    }): Promise<string | null>;
}
export class GoogleIdentityLinkService implements GoogleIdentityLinkServicePort {
    public readonly enabled: boolean;
    private readonly now: () => Date;
    public constructor(private readonly dependencies: {
        repository: GoogleIdentityLinkRepository;
        gateway: GoogleIdentityLinkGateway;
        config: GoogleLinkConfig | null;
        now?: () => Date;
    }) {
        this.enabled = dependencies.config !== null;
        this.now = dependencies.now ?? (() => new Date());
    }
    public async start(user: AuthenticatedUser, proof: VerifiedCognitoIdentity | null, input: {
        platform: 'mobile' | 'web';
        request_key: string;
    }): Promise<GoogleLinkStartResponse> {
        const config = this.config();
        const existing = await this.dependencies.repository.findRequest(user.id, input.request_key);
        if (existing !== null)
            return this.startReceipt(existing, proof, config);
        if (proof === null || proof.subject !== user.supabaseId || normalizeEmail(proof.email) !== normalizeEmail(user.email)
            || !Number.isSafeInteger(proof.authTime) || this.now().getTime() / 1000 - proof.authTime > GOOGLE_LINK_RECENT_AUTH_SECONDS
            || proof.authTime - this.now().getTime() / 1000 > 60)
            throw new AppError('RECENT_AUTH_REQUIRED', 'Sign in again using the existing account method', 401);
        const native = await this.dependencies.gateway.getNativeIdentity(proof.username);
        assertNative(native, proof.subject, googleLinkHash(normalizeEmail(proof.email), config.encryptionSecret, 'email'), config);
        const material = createGoogleLinkMaterial();
        const id = randomUUID();
        const createdAt = this.now();
        const row = await this.dependencies.repository.create({ id, userId: user.id, requestKey: input.request_key,
            sessionHash: googleLinkHash(proof.tokenFingerprint, config.encryptionSecret, 'session'), stateHash: googleLinkHash(material.state, config.encryptionSecret, 'state'),
            emailHash: googleLinkHash(normalizeEmail(proof.email), config.encryptionSecret, 'email'), nativeSubject: proof.subject, nativeUsername: proof.username,
            exchangeMaterial: encryptGoogleLinkMaterial(material, config.encryptionSecret, id), platform: input.platform, status: 'pending', providerSubjectHash: null, messageCode: null,
            createdAt, expiresAt: new Date(createdAt.getTime() + GOOGLE_LINK_TTL_MS), consumedAt: null });
        return this.startReceipt(row, proof, config);
    }
    public async status(user: AuthenticatedUser, id: string): Promise<GoogleLinkReceipt> {
        const config = this.config();
        let row = await this.dependencies.repository.findForUser(id, user.id);
        if (row === null || row.nativeSubject !== user.supabaseId)
            throw new NotFoundError('Identity link request not found');
        if (['pending', 'processing'].includes(row.status) && row.providerSubjectHash === null && row.expiresAt <= this.now()) {
            await this.dependencies.repository.finish(id, 'expired');
            row = await this.dependencies.repository.findForUser(id, user.id);
            if (row === null) throw new NotFoundError('Identity link request not found');
        }
        if (row.providerSubjectHash !== null && ['processing', 'recovery_required'].includes(row.status)) {
            // An AWS timeout or a lost DB connection is not permission to repeat a
            // security mutation. Only verified provider state can settle this receipt.
            try {
                const native = await this.dependencies.gateway.getNativeIdentity(row.nativeUsername);
                assertNative(native, row.nativeSubject, row.emailHash, config);
                if (native.googleSubjects.some(subject => secureHashEquals(googleLinkHash(subject, config.encryptionSecret, 'provider-subject'), row.providerSubjectHash!))) {
                    await this.dependencies.repository.completeReconciliation(id, row.providerSubjectHash);
                    row.status = 'linked';
                    row.messageCode = null;
                }
            }
            catch { /* Keep an explicit, recoverable receipt without leaking provider errors. */ }
        }
        return receipt(row);
    }
    public async callback(input: {
        state: string;
        code?: string;
        error?: string;
    }): Promise<string | null> {
        const config = this.config();
        if (!/^[A-Za-z0-9_-]{43,128}$/u.test(input.state))
            return null;
        const stateHash = googleLinkHash(input.state, config.encryptionSecret, 'state');
        const row = await this.dependencies.repository.claimState(stateHash);
        if (row === null) {
            // A consumed callback is only a return capability. Status still needs
            // the authenticated owner; never replay the OAuth code or mutation.
            const consumed = await this.dependencies.repository.findConsumedState(stateHash);
            return consumed === null || consumed.expiresAt <= this.now() ? null : this.returnUri(consumed, config);
        }
        let reserved = false;
        let linkAttemptStarted = false;
        let reservedHash: string | null = null;
        try {
            if (input.error !== undefined) {
                await this.dependencies.repository.finish(row.id, 'cancelled');
                return this.returnUri(row, config);
            }
            if (!input.code || input.code.length > 4096 || row.exchangeMaterial === null || row.expiresAt <= this.now())
                throw new Error('Invalid callback');
            const material = decryptGoogleLinkMaterial(row.exchangeMaterial, config.encryptionSecret, row.id);
            if (!secureHashEquals(material.state, input.state))
                throw new Error('Invalid callback');
            const google = await this.dependencies.gateway.exchangeCode({ code: input.code, verifier: material.verifier, nonce: material.nonce });
            if (!secureHashEquals(googleLinkHash(normalizeEmail(google.email), config.encryptionSecret, 'email'), row.emailHash)) {
                await this.dependencies.repository.finish(row.id, 'failed', 'EMAIL_MISMATCH');
                return this.returnUri(row, config);
            }
            const native = await this.dependencies.gateway.getNativeIdentity(row.nativeUsername);
            assertNative(native, row.nativeSubject, row.emailHash, config);
            const subjectHash = googleLinkHash(google.subject, config.encryptionSecret, 'provider-subject');
            await this.dependencies.repository.reserveIdentity(row.id, subjectHash);
            reserved = true;
            reservedHash = subjectHash;
            if (native.googleSubjects.includes(google.subject)) {
                await this.dependencies.repository.completeReconciliation(row.id, subjectHash);
                return this.returnUri(row, config);
            }
            const source = await this.dependencies.gateway.getGoogleProfile(google.subject);
            if (source !== null) {
                if (config.sourceRecoveryEnabled !== true || source.subject === row.nativeSubject
                    || source.googleSubject !== google.subject || normalizeEmail(source.email) !== normalizeEmail(google.email))
                    throw new AppError('IDENTITY_LINK_CONFLICT', 'Google identity requires account recovery', 409);
                // Commit the source-subject fence before retiring its unused
                // authentication profile. Native assets and identity never move.
                await this.dependencies.repository.prepareSourceRetirement(row.id, subjectHash, source.subject);
                await this.dependencies.repository.performSourceRetirement(row.id, subjectHash, source.subject,
                    async () => this.dependencies.gateway.deleteGoogleProfile(source));
            }
            linkAttemptStarted = true;
            await this.dependencies.repository.performLink(row.id, subjectHash, async () => {
                // Revalidate destination immediately before the call, while the user
                // deletion gate is locked by the repository.
                assertNative(await this.dependencies.gateway.getNativeIdentity(row.nativeUsername), row.nativeSubject, row.emailHash, config);
                await this.dependencies.gateway.linkGoogleIdentity(row.nativeUsername, google.subject);
            });
        }
        catch (error) {
            try {
                if (reserved && reservedHash !== null && (!linkAttemptStarted || (error instanceof AppError && error.code === 'GOOGLE_LINK_REJECTED'))) {
                    await this.dependencies.repository.rejectLink(row.id, reservedHash);
                    return this.returnUri(row, config);
                }
                await this.dependencies.repository.finish(row.id, reserved ? 'recovery_required' : 'failed', reserved ? 'RECOVERY_REQUIRED' : error instanceof AppError && error.statusCode === 409 ? 'LINK_CONFLICT' : 'GOOGLE_LINK_FAILED');
            }
            catch { /* Durable intent, when present, remains available to reconciliation. */ }
        }
        return this.returnUri(row, config);
    }
    private startReceipt(row: GoogleLinkChallenge, proof: VerifiedCognitoIdentity | null, config: GoogleLinkConfig): GoogleLinkStartResponse {
        const sameSession = proof !== null && proof.subject === row.nativeSubject && secureHashEquals(googleLinkHash(proof.tokenFingerprint, config.encryptionSecret, 'session'), row.sessionHash);
        const fresh = row.expiresAt > this.now();
        return { ...receipt({ ...row, status: row.status === 'pending' && !fresh ? 'expired' : row.status }), requires_reauthentication: !sameSession,
            authorization_url: row.status === 'pending' && fresh && sameSession && row.exchangeMaterial !== null
                ? googleLinkAuthorizationUrl({ clientId: config.clientId, redirectUri: config.redirectUri, material: decryptGoogleLinkMaterial(row.exchangeMaterial, config.encryptionSecret, row.id) }) : null };
    }
    private returnUri(row: GoogleLinkChallenge, config: GoogleLinkConfig): string {
        const url = new URL(row.platform === 'mobile' ? config.nativeReturnUri : config.webReturnUri);
        url.searchParams.set('challenge_id', row.id);
        return url.toString();
    }
    private config(): GoogleLinkConfig {
        if (this.dependencies.config === null)
            throw new AppError('GOOGLE_LINK_DISABLED', 'Google identity linking is unavailable', 409);
        return this.dependencies.config;
    }
}
function receipt(row: GoogleLinkChallenge): GoogleLinkReceipt {
    return { challenge_id: row.id, status: row.status, expires_at: row.expiresAt.toISOString(), requires_reauthentication: false, ...(row.messageCode === null ? {} : { message_code: row.messageCode }) };
}
function assertNative(native: NativeCognitoIdentity, subject: string, emailHash: string, config: GoogleLinkConfig): void {
    if (!native.enabled || native.status !== 'CONFIRMED' || native.subject !== subject || !secureHashEquals(googleLinkHash(normalizeEmail(native.email), config.encryptionSecret, 'email'), emailHash))
        throw new AppError('IDENTITY_LINK_CONFLICT', 'The existing account could not be verified for linking', 409);
}
function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
