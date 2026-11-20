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

export type CharacterAutofillResult = z.infer<typeof characterAutofillResultSchema>;
