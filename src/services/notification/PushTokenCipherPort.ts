export interface PushTokenEncryptionResult {
  ciphertext: string;
  keyId: string;
}

export interface PushTokenDecryptionInput {
  ciphertext: string;
  keyId: string;
}

/**
 * Production implementations must use authenticated encryption and a keyed,
 * deterministic hash. Provider tokens are sensitive identifiers.
 */
export interface PushTokenCipherPort {
  encrypt(value: string): Promise<PushTokenEncryptionResult>;
  decrypt(input: PushTokenDecryptionInput): Promise<string>;
  deterministicHash(value: string): Promise<string>;
}
