import { ConfigurationError } from '../errors/index.js';

export interface EntityStateReferenceImageKeyInput {
  userId: string;
  entityId: string;
  stateId: string;
  refId: string;
  sourceS3Key: string;
}

/** Share the exact deterministic destination between durable admission and S3. */
export function buildEntityStateReferenceImageKey(input: EntityStateReferenceImageKeyInput): string {
  for (const segment of [input.userId, input.entityId, input.stateId, input.refId]) {
    if (!/^[A-Za-z0-9_-]+$/u.test(segment)) {
      throw new ConfigurationError('Entity state reference destination segment is invalid');
    }
  }
  const key = input.sourceS3Key;
  if (key.includes('\\') || key.includes('\0')
    || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || ![ `tmp/${input.userId}/entities/imports/`, `session/${input.userId}/entities/${input.entityId}/` ]
      .some((prefix) => key.startsWith(prefix))) {
    throw new ConfigurationError('Entity state reference source image is outside the owner scope');
  }
  const extension = key.endsWith('.png') ? 'png'
    : key.endsWith('.webp') ? 'webp'
    : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'jpeg' : null;
  if (extension === null) {
    throw new ConfigurationError('Unsupported entity state reference source image extension');
  }
  return `saved/${input.userId}/entities/${input.entityId}/states/${input.stateId}/${input.refId}.${extension}`;
}
