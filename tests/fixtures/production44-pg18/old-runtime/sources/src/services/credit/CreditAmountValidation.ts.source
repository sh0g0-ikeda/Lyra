import { ValidationError } from '../../domain/errors/index.js';

export function assertPositiveSafeCreditAmount(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${fieldName} must be a positive safe integer`);
  }
}
