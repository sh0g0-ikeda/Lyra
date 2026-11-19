import { z } from 'zod';

const quote = z.string().trim().min(1).max(500);
const name = z.string().trim().min(1).max(100);
const appearanceSchema = z.object({
  field: z.enum(['hair_color', 'hair_length', 'hair_style', 'eye_color', 'clothing', 'features']),
  value: z.string().trim().min(1).max(200),
  quote,
}).strict();
const changeSchema = z.object({
  label: name,
  description: z.string().trim().min(1).max(300),
  quote,
}).strict();

export const extractedCharacterSchema = z.object({
  name,
  name_quote: quote,
  entity_type: z.enum(['character', 'nonhuman']).nullable(),
  appearance: z.array(appearanceSchema).max(6),
  changes: z.array(changeSchema).max(4),
}).strict();

export const extractedCharactersSchema = z.object({
  characters: z.array(extractedCharacterSchema).max(30),
}).strict();

export const characterSuggestionSchema = extractedCharacterSchema.extend({
  status: z.enum(['new', 'existing', 'ambiguous']),
  entity_ids: z.array(z.string().uuid()),
});

export const characterSuggestionsSchema = z.object({
  version: z.number().int().min(0),
  characters: z.array(characterSuggestionSchema).max(30),
}).strict();

export type ExtractedCharacter = z.infer<typeof extractedCharacterSchema>;
export type EpisodeCharacterSuggestion = z.infer<typeof characterSuggestionSchema>;
