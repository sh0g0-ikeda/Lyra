export interface PushTokenEncryptionResult {
  ciphertext: string;
  keyId: string;
}

export interface PushTokenDecryptionInput {
  ciphertext: string;
  keyId: string;
}

export interface PushTokenCipherPort {
  encrypt(value: string): Promise<PushTokenEncryptionResult>;
  decrypt(input: PushTokenDecryptionInput): Promise<string>;
  deterministicHash(value: string): Promise<string>;
}
