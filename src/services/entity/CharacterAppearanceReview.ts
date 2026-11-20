import { humanAppearanceChoices } from '../../../packages/api-contract/src/characterAppearanceCatalog.js';
import { ResourceStaleError, ValidationError } from '../../domain/errors/index.js';

type ChoiceField = keyof typeof humanAppearanceChoices;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isCharacterAppearanceChoice(field: string, value: string): boolean {
  return Object.hasOwn(humanAppearanceChoices, field) && value !== '' && value !== 'custom'
    && humanAppearanceChoices[field as ChoiceField].some(choice => choice.value === value);
}

function populated(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

// Old editors also persisted flat fields. A custom value in either representation
// belongs to the author and makes this field ineligible for an empty-field offer.
export function readCharacterAppearanceChoice(fields: unknown, field: string): unknown {
  if (!isRecord(fields) || !Object.hasOwn(humanAppearanceChoices, field)) return undefined;
  const [group, member] = field.split('.');
  const container = fields[group];
  if (!member || (populated(container) && !isRecord(container))) {
    return populated(container) ? container : undefined;
  }
  if (isRecord(container) && populated(container[member])) return container[member];
  const aliases: Record<string, string> = {
    eyes: member === 'eyelid_type' ? member : `eye_${member}`,
    hair: `hair_${member}`,
    hair_detail: `hair_${member}`,
    clothing: `clothing_${member}`,
    face_detail: member,
    outfit_detail: member,
  };
  const legacy = fields[aliases[group]];
  return populated(legacy) ? legacy : undefined;
}

export function applyAppearanceChoice(
  fields: Record<string, unknown>,
  field: string,
  value: string,
): Record<string, unknown> {
  if (!isCharacterAppearanceChoice(field, value)) throw new ValidationError('Unknown character appearance choice');
  if (readCharacterAppearanceChoice(fields, field) !== undefined) throw new ResourceStaleError();
  const [group, member] = field.split('.');
  if (!member) return { ...fields, [group]: value };
  const current = fields[group];
  return { ...fields, [group]: { ...(isRecord(current) ? current : {}), [member]: value } };
}
