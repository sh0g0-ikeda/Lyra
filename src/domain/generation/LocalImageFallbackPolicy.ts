export interface LocalImageFallbackPolicyInput {
  localAssetStorageConfigured: boolean;
  localImageFallbackEnabled: boolean;
}

export function shouldUseLocalImageFallback(input: LocalImageFallbackPolicyInput): boolean {
  return input.localAssetStorageConfigured && input.localImageFallbackEnabled;
}
