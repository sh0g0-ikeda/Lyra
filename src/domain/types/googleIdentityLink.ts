import type { GoogleLinkStatus } from '../auth/GoogleLinkProtocol.js';
export interface VerifiedCognitoIdentity {
    subject: string;
    username: string;
    email: string;
    authTime: number;
    tokenFingerprint: string;
}
export interface GoogleLinkChallenge {
    id: string;
    userId: string;
    requestKey: string;
    sessionHash: string;
    stateHash: string;
    emailHash: string;
    nativeSubject: string;
    nativeUsername: string;
    exchangeMaterial: string | null;
    platform: 'mobile' | 'web';
    status: GoogleLinkStatus;
    providerSubjectHash: string | null;
    messageCode: string | null;
    createdAt: Date;
    expiresAt: Date;
    consumedAt: Date | null;
}
export interface GoogleLinkReceipt {
    challenge_id: string;
    status: GoogleLinkStatus;
    expires_at: string;
    message_code?: string;
    requires_reauthentication: boolean;
}
export interface GoogleLinkStartResponse extends GoogleLinkReceipt {
    authorization_url: string | null;
}
