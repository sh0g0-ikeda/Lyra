/**
 * Shared model guidance for cast and page planning. Persistence is a narrative
 * judgment, not a keyword or minimum-panel-count gate; source/ownership checks
 * remain independent. Short-lived rendering effects belong to the panel draft.
 */
export const CHARACTER_STATE_EXTRACTION_RULES: readonly string[] = [
  'A character state is a clear change to the character that later panels or pages need to carry forward: injuries or wounds, loss of body parts, a sustained awakened or transformed form, putting on/removing/changing clothes, or aging and age changes across a time skip. These examples are not an exhaustive category list.',
  'Use the story context to judge persistence. A lasting change mentioned once is enough; do not demand repeated descriptions, an explicit duration, or a minimum number of already drawn panels. A clear lasting change at the end of the episode still qualifies.',
  'Do not create a character state for one-panel lighting, shadows, reflections, highlights, momentary flashes or sparks, a passing wind effect, poses, expressions, or other transient staging. Keep those details in that panel\'s composition or effect settings, not in the base character or a continuing state.',
  'Missing an explicit return-to-normal sentence does not make a lighting or momentary effect persistent. If the source only describes a brief effect, leave it local to the panel and do not propagate it or invent a state/reset boundary.',
  'The same word can describe either kind: light reflected from a face is panel-only; a sustained glow or changed eyes that belong to an awakened form can be a state. Judge the surrounding story, not a glow/lighting keyword alone.',
  'Group the linked manifestations of one continuing condition into one state: an awakening and its changed eyes, or aging into a white-haired elder, are not separate generic and detailed states. Split only independently continuing changes that can end separately, such as a wound and a changed outfit. Reuse existing source-backed candidates for the same condition rather than adding a duplicate label.',
  'Separate the continuing condition from its momentary trigger: record the wound, missing limb, changed outfit, age or sustained form, not each intermediate motion or flash. Preserve only the attributes the source actually states; never invent the appearance of an awakening or another condition.',
];
