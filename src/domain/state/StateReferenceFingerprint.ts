import { createHash } from 'node:crypto';

export interface StateReferenceInput {
  entityId: string;
  stateId: string;
  name: string;
  description: string;
  baseRefId: string;
}

export function computeStateReferenceFingerprint(input: StateReferenceInput): string {
  return createHash('sha256')
    .update('state-reference-v1\0')
    .update(JSON.stringify([
      input.entityId,
      input.stateId,
      input.name,
      input.description,
      input.baseRefId,
    ]))
    .digest('hex');
}
