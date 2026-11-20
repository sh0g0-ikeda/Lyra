// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

/** Saved rows can be reopened in the ordinary character and state editors. */
export const characterAutofillResultSchema = z.object({
  version: z.number().int().min(0),
  characters: z.array(z.object({
    entity_id: z.string().uuid(),
    name: z.string().min(1).max(100),
    created: z.boolean(),
    states_added: z.number().int().nonnegative(),
  }).strict()).max(30),
  skipped_names: z.array(z.string().min(1).max(100)).max(30),
}).strict();

export const characterAppearanceIssueSchema = z.object({
  quote: z.string().min(1).max(500),
  reason: z.enum(['ambiguous_character', 'conflicting_traits', 'unverified_trait']),
}).strict();

const characterAppearanceSuggestionSchema = z.object({
  entity_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  field: z.string().min(1).max(100),
  value: z.string().min(1).max(150),
  quote: z.string().min(1).max(500),
  expected_updated_at: z.string().datetime({ offset: true }),
}).strict();

// Released clients reject extra response properties. Only clients requesting
// appearance_review=1 use this reader, which also accepts an older server's reply.
export const characterAutofillWithReviewResultSchema = characterAutofillResultSchema.extend({
  appearance_review: z.object({
    unresolved: z.array(characterAppearanceIssueSchema).max(1920),
    suggestions: z.array(characterAppearanceSuggestionSchema).max(1920),
  }).strict().optional(),
});

export type CharacterAppearanceIssue = z.infer<typeof characterAppearanceIssueSchema>;
export type CharacterAppearanceSuggestion = z.infer<typeof characterAppearanceSuggestionSchema>;
export type CharacterAutofillResult = z.infer<typeof characterAutofillWithReviewResultSchema>;
