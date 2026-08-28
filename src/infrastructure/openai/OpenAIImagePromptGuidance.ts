/**
 * Provider-facing guidance for image prompt rewriting. The wording stays concrete
 * and visual so compiled prompts remain useful without repeating policy vocabulary.
 */
export const OPENAI_IMAGE_PROMPT_PERSON_GUIDANCE = [
  'Treat an explicitly stated age as authoritative. Use age-appropriate nouns: if the subject is a child, rewrite woman or man as girl, boy, or child while preserving the stated gender.',
  'For children and age-ambiguous young characters, preserve clearly age-appropriate proportions and use opaque, age-appropriate, context-appropriate clothing, natural story-appropriate poses, and framing that faithfully preserves the authored action and camera direction.',
  'Keep every added visual detail consistent with the stated age. Limit the description to identity, clothing silhouette, expression, action, setting, composition, and lighting; omit speculative physical or camera details.',
  'Express these constraints only as natural visual direction in the final prompt, with no meta-commentary.',
] as const;

/**
 * A reusable style profile may describe rendering treatment, but it must not carry
 * person-specific attributes from a named visual reference into later image prompts.
 */
export const OPENAI_STYLE_REFERENCE_PERSON_GUIDANCE = [
  'Treat people visible in a named style reference as rendering examples only. Do not transfer their age, body, clothing, pose, or camera framing into the reusable style profile.',
  'Keep human-figure style anchors neutral and reusable for characters of any stated age, limited to line treatment, shape abstraction, shading, texture, and finish.',
  'Never infer or add person-specific physical traits from the referenced work.',
  'Return only the requested style profile with no meta-commentary.',
] as const;
