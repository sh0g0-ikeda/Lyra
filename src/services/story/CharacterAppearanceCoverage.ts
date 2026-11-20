import { z } from 'zod';
import { humanAppearanceChoices } from '../../../packages/api-contract/src/characterAppearanceCatalog.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { Episode } from '../../domain/types/story.js';
import {
  buildCharacterAutofillCandidates,
  characterAutofillExtractionSchema,
  characterAutofillHumanFieldIds,
  characterAutofillNonhumanFieldIds,
  extractCharacterAutofillEvidence,
  isCharacterAppearanceEvidenceGrounded,
  normalizeHumanAppearanceChoiceEvidence,
  type CharacterAutofillCandidate,
  type CharacterAutofillExtraction,
} from './CharacterAutofillFields.js';
import type { StoryAiClientPort } from './StoryAiClientPort.js';

export const characterAppearanceCoverageReasons = [
  'ambiguous_character', 'conflicting_traits', 'unverified_trait',
] as const;
type CoverageReason = (typeof characterAppearanceCoverageReasons)[number];

export interface CharacterAppearanceCoverageResult {
  candidates: CharacterAutofillCandidate[];
  unresolved: Array<{ quote: string; reason: CoverageReason }>;
}

const humanFieldSchema = z.enum(asNonEmptyTuple(characterAutofillHumanFieldIds));
const nonhumanFieldSchema = z.enum(asNonEmptyTuple(characterAutofillNonhumanFieldIds));
const optionIds = [...new Set(Object.values(humanAppearanceChoices)
  .flatMap(choices => choices.map(choice => choice.value)).filter(Boolean))];
const optionIdSchema = z.enum(asNonEmptyTuple(optionIds));
const quoteSchema = z.string().trim().min(1).max(500);
const valueSchema = z.string().trim().min(1).max(300);

const humanTraitSchema = z.object({
  field: humanFieldSchema, option_id: optionIdSchema.nullable(), value: valueSchema, quote: quoteSchema,
}).strict().superRefine((trait, context) => {
  if (!Object.hasOwn(humanAppearanceChoices, trait.field)) {
    if (trait.option_id !== null) context.addIssue({ code: 'custom', path: ['option_id'], message: 'Text fields cannot carry an option ID' });
    return;
  }
  if (trait.option_id === null) {
    context.addIssue({ code: 'custom', path: ['option_id'], message: 'Catalog fields require an exact option ID' });
    return;
  }
  const field = trait.field as keyof typeof humanAppearanceChoices;
  if (!humanAppearanceChoices[field].some(choice => choice.value === trait.option_id)) {
    context.addIssue({ code: 'custom', path: ['option_id'], message: `Option is not valid for ${field}` });
    return;
  }
  if (!normalizeHumanAppearanceChoiceEvidence(field, trait.value, trait.quote)
    .some(evidence => evidence.value === trait.option_id)) {
    context.addIssue({ code: 'custom', path: ['option_id'], message: 'Option does not match the literal evidence' });
  }
});
const nonhumanTraitSchema = z.object({
  field: nonhumanFieldSchema, option_id: z.null(), value: valueSchema, quote: quoteSchema,
}).strict();
const changeSchema = z.object({
  name: z.string().trim().min(1).max(100), description: valueSchema, quote: quoteSchema,
}).strict();
const common = {
  name: z.string().trim().min(1).max(100), name_quote: quoteSchema,
  changes: z.array(changeSchema).max(12),
};
const additionSchema = z.union([
  z.object({ ...common, entity_type: z.literal('character'), appearance: z.array(humanTraitSchema).max(64) }).strict(),
  z.object({ ...common, entity_type: z.literal('nonhuman'), appearance: z.array(nonhumanTraitSchema).max(64) }).strict(),
  z.object({ ...common, entity_type: z.null(), appearance: z.array(humanTraitSchema).max(64) }).strict(),
]);

export const characterAppearanceCoverageResponseSchema = z.object({
  additions: z.array(additionSchema).max(30),
  unresolved: z.array(z.object({ quote: quoteSchema, reason: z.enum(characterAppearanceCoverageReasons) }).strict()).max(120),
}).strict();
export type CharacterAppearanceCoverageResponse = z.infer<typeof characterAppearanceCoverageResponseSchema>;

/** Both provider passes finish before any candidate is exposed to persistence. */
export async function extractCharacterAutofillWithCoverage(
  client: StoryAiClientPort,
  episode: Episode,
): Promise<CharacterAppearanceCoverageResult> {
  if (client.reconcileCharacterAutofillCoverage === undefined) {
    throw new ConfigurationError('Character autofill coverage is unavailable');
  }
  const { source, extraction: first } = await extractCharacterAutofillEvidence(client, episode);
  if (source.length === 0) return { candidates: [], unresolved: [] };
  const coverage = await client.reconcileCharacterAutofillCoverage({
    systemPrompt: COVERAGE_SYSTEM_PROMPT,
    userPrompt: JSON.stringify({ original_manuscript: source, first_extraction: first, allowed_human_catalog: characterAppearanceCatalogForModel }),
  });
  const unresolved: CharacterAppearanceCoverageResult['unresolved'] = coverage.unresolved
    .filter(item => source.some(part => part.includes(item.quote)));
  const conflictedFields = new Set<string>();
  const normalizedFirst = mergeExtractions(source, [], first, unresolved, conflictedFields);
  const providerMerged = mergeExtractions(
    source, normalizedFirst, toExtraction(coverage.additions), unresolved, conflictedFields,
  );
  const scanned = scanDeterministicOmissions(source, providerMerged, unresolved);
  const combined = mergeExtractions(source, providerMerged, scanned, unresolved, conflictedFields);
  return { candidates: buildCharacterAutofillCandidates(source, combined), unresolved: deduplicateUnresolved(unresolved) };
}

export const characterAppearanceCatalogForModel: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(humanAppearanceChoices).map(([field, choices]) => [
    field, choices.filter(choice => choice.value.length > 0).map(choice => choice.value),
  ])),
);

const COVERAGE_SYSTEM_PROMPT = [
  'Independently reconcile character appearance coverage against the entire ORIGINAL manuscript.',
  'Compare the first extraction with the manuscript. Return only omitted literal source-grounded traits or omitted individually named characters in additions.',
  'Also correct first-pass general-field misclassification when the same literal belongs to a specific catalog field.',
  'Never invent a character, trait, quotation or option. Exclude unnamed, hypothetical, negated and changed-only base appearances.',
  'Keep value and quote as literal source text. field and option_id are separate canonical identifiers. Catalog fields require an exact allowed option_id; otherwise report unverified_trait. Nonhuman and free-text fields use null option_id.',
  'Preserve exact colors, shapes and part counts. Keep each nonhuman body part with its color and count in one literal value. Put later appearance changes only in changes.',
  'Report ambiguous ownership, conflicting traits and unverifiable evidence in unresolved.',
].join(' ');

interface MutableTrait { field: string; value: string; quote: string }
interface MutableCharacter {
  name: string; name_quote: string; entity_type: 'character' | 'nonhuman' | null;
  appearance: MutableTrait[]; changes: Array<{ name: string; description: string; quote: string }>;
}

function toExtraction(additions: CharacterAppearanceCoverageResponse['additions']): CharacterAutofillExtraction {
  return characterAutofillExtractionSchema.parse({ characters: additions.map(addition => ({
    name: addition.name, name_quote: addition.name_quote, entity_type: addition.entity_type,
    appearance: addition.appearance.map(({ field, value, quote }) => ({ field, value, quote })),
    changes: addition.changes,
  })) }).characters;
}

function mergeExtractions(
  source: readonly string[],
  first: CharacterAutofillExtraction,
  additions: CharacterAutofillExtraction,
  unresolved: CharacterAppearanceCoverageResult['unresolved'],
  conflictedFields: Set<string>,
): CharacterAutofillExtraction {
  const merged = first.map(toMutable);
  const allNames = [...merged.map(character => character.name), ...additions.map(character => character.name)];
  for (const addition of additions.map(toMutable)) {
    let existing = merged.find(character => normalizeName(character.name) === normalizeName(addition.name)
      && character.entity_type === addition.entity_type);
    if (existing === undefined) {
      existing = { ...addition, appearance: [], changes: [] };
      merged.push(existing);
    }
    for (const trait of addition.appearance) {
      if (existing.appearance.some(current => sameTrait(current, trait))) continue;
      const otherNames = allNames.filter(name => normalizeName(name) !== normalizeName(existing.name));
      if (!isCharacterAppearanceEvidenceGrounded({
        source, characterName: existing.name, otherCharacterNames: otherNames,
        quote: trait.quote, value: trait.value,
      })) continue;
      const incomingChoices = normalizeHumanAppearanceChoiceEvidence(trait.field, trait.value, trait.quote);
      const alreadyConflicted = incomingChoices.some(choice =>
        conflictedFields.has(`${normalizeName(existing.name)}\u0000${choice.field}`));
      if (alreadyConflicted) {
        unresolved.push({ quote: trait.quote, reason: 'conflicting_traits' });
        continue;
      }
      const groundedCurrent = existing.appearance.filter(current => isCharacterAppearanceEvidenceGrounded({
        source, characterName: existing.name, otherCharacterNames: otherNames,
        quote: current.quote, value: current.value,
      }));
      const conflicts = groundedCurrent.filter(current => {
        const choices = normalizeHumanAppearanceChoiceEvidence(current.field, current.value, current.quote);
        return incomingChoices.some(incoming => choices.some(choice =>
          choice.field === incoming.field && choice.value !== incoming.value));
      });
      if (conflicts.length > 0) {
        const conflictKeys = new Set(conflicts.map(current => `${current.field}\u0000${current.value}\u0000${current.quote}`));
        existing.appearance = existing.appearance.filter(current =>
          !conflictKeys.has(`${current.field}\u0000${current.value}\u0000${current.quote}`));
        for (const conflict of conflicts) unresolved.push({ quote: conflict.quote, reason: 'conflicting_traits' });
        unresolved.push({ quote: trait.quote, reason: 'conflicting_traits' });
        for (const choice of incomingChoices) {
          conflictedFields.add(`${normalizeName(existing.name)}\u0000${choice.field}`);
        }
        continue;
      }
      // A specific catalog assignment supersedes the same literal previously
      // misclassified into a general/free-description field.
      if (incomingChoices.length > 0) existing.appearance = existing.appearance.filter(current => !(
        current.quote === trait.quote && current.value === trait.value
        && normalizeHumanAppearanceChoiceEvidence(current.field, current.value, current.quote).length === 0
      ));
      existing.appearance.push(trait);
    }
    for (const change of addition.changes) if (!existing.changes.some(current =>
      current.name === change.name && current.description === change.description && current.quote === change.quote)) {
      existing.changes.push(change);
    }
  }
  return characterAutofillExtractionSchema.parse({ characters: merged }).characters;
}

function toMutable(character: CharacterAutofillExtraction[number]): MutableCharacter {
  return {
    name: character.name, name_quote: character.name_quote, entity_type: character.entity_type,
    appearance: character.appearance.map(trait => ({ ...trait })),
    changes: character.changes.map(change => ({ ...change })),
  };
}
function sameTrait(a: MutableTrait, b: MutableTrait): boolean {
  return a.field === b.field && a.value === b.value && a.quote === b.quote;
}

const scanners: ReadonlyArray<{ field: 'hair.color' | 'eyes.color'; pattern: RegExp; value: (match: RegExpMatchArray) => string }> = [
  { field: 'hair.color', pattern: /(?:黒髪|茶髪|金髪|銀髪|白髪|青髪|赤髪|緑髪|ピンク髪|紫髪|灰色の髪|グレーの髪|焦げ茶(?:色)?の髪)/gu, value: match => match[0] },
  { field: 'hair.color', pattern: /(?:髪|前髪|後ろ髪)(?:の色)?[はが](黒い|茶色|金色|銀色|白い|青い|赤い|緑色|ピンク|紫色|灰色|グレー)/gu, value: match => match[1] ?? match[0] },
  { field: 'eyes.color', pattern: /(?:黒|茶|青|緑|赤|金|銀|紫)(?:い|色の)?(?:目|瞳)/gu, value: match => match[0] },
  { field: 'eyes.color', pattern: /(?:目|瞳)(?:の色)?[はが](黒い|茶色|青い|緑色|赤い|金色|銀色|紫色)/gu, value: match => match[1] ?? match[0] },
];
const unsafeContext = /(?:もし|ならば|かもしれ|ではない|じゃない|染め|変わ(?:った|る)|変化(?:した|する)|になった|\b(?:if|might|not|dyed?|changed?|turned?)\b)/iu;
const unclassifiedAppearance = /(?:傷|痣|ほくろ|刺青|紋様|斑点|角|翼|尾|牙)/u;

function scanDeterministicOmissions(
  source: readonly string[], cast: CharacterAutofillExtraction,
  unresolved: CharacterAppearanceCoverageResult['unresolved'],
): CharacterAutofillExtraction {
  const humans = cast.filter(character => character.entity_type === 'character');
  const additions = new Map<string, MutableCharacter>();
  let previous: CharacterAutofillExtraction[number] | null = null;
  let anchoredQuote = '';
  for (const text of source) {
    previous = null;
    anchoredQuote = '';
    for (const sentenceValue of text.match(/[^\n。！？!?]+[\n。！？!?]?/gu) ?? []) {
      const sentence = sentenceValue.trim();
      if (!sentence) continue;
      const mentionedCast = cast.filter(character => sentence.includes(character.name));
      const mentionedHuman = mentionedCast.filter(character => character.entity_type === 'character');
      const unknownLeadingSubject = detectUnknownLeadingSubject(sentence, cast)
        && !unclassifiedAppearance.test(sentence);
      const canContinue = mentionedCast.length === 0 && !unknownLeadingSubject
        && (scanners.some(scanner => {
          scanner.pattern.lastIndex = 0;
          return scanner.pattern.test(sentence);
        }) || unclassifiedAppearance.test(sentence));
      const subject = mentionedHuman.length === 1 && mentionedCast.length === 1
        ? mentionedHuman[0]
        : canContinue ? previous : null;
      if (mentionedHuman.length === 1 && mentionedCast.length === 1) {
        previous = mentionedHuman[0] ?? null;
        anchoredQuote = sentence;
      } else if (canContinue && previous !== null) {
        anchoredQuote = `${anchoredQuote}${sentence}`;
      } else {
        previous = null;
        anchoredQuote = '';
      }
      if (subject === null || subject === undefined || unsafeContext.test(sentence)) continue;
      const others = humans
        .filter(candidate => normalizeName(candidate.name) !== normalizeName(subject.name))
        .map(candidate => candidate.name);
      const evidenceQuote = mentionedCast.length === 0 ? anchoredQuote : sentence;
      if (evidenceQuote.length > 500) continue;
      let matched = false;
      for (const scanner of scanners) {
        scanner.pattern.lastIndex = 0;
        for (const match of sentence.matchAll(scanner.pattern)) {
          const value = scanner.value(match);
          if (!isCharacterAppearanceEvidenceGrounded({
            source,
            characterName: subject.name,
            otherCharacterNames: others,
            quote: evidenceQuote,
            value,
          })) continue;
          if (normalizeHumanAppearanceChoiceEvidence(scanner.field, value, evidenceQuote).length === 0) continue;
          const key = normalizeName(subject.name);
          const addition = additions.get(key) ?? {
            name: subject.name,
            name_quote: subject.name_quote,
            entity_type: 'character',
            appearance: [],
            changes: [],
          };
          addition.appearance.push({ field: scanner.field, value, quote: evidenceQuote });
          additions.set(key, addition);
          matched = true;
        }
      }
      // Unclassified visible evidence stays reviewable unless the first pass
      // already retained the same literal in a general field.
      const alreadyCovered = subject.appearance.some(trait =>
        sentence.includes(trait.value)
        || trait.quote.includes(sentence.replace(/[。！？!?]$/u, '')));
      const unresolvedValue = sentence.replace(/[。！？!?]$/u, '');
      if (!matched && !alreadyCovered && sentence.length <= 500
        && mentionedCast.length === 0 && unclassifiedAppearance.test(sentence)
        && isCharacterAppearanceEvidenceGrounded({
          source,
          characterName: subject.name,
          otherCharacterNames: others,
          quote: evidenceQuote,
          value: unresolvedValue,
        })) {
        unresolved.push({ quote: sentence, reason: 'unverified_trait' });
      }
    }
  }
  return characterAutofillExtractionSchema.parse({ characters: [...additions.values()] }).characters;
}

function detectUnknownLeadingSubject(
  sentence: string,
  cast: CharacterAutofillExtraction,
): boolean {
  const match = /^([^\s、。！？!?]{1,30})[はが]/u.exec(sentence);
  if (match === null) return false;
  const subject = match[1] ?? '';
  if (/^(?:髪|前髪|後ろ髪|目|瞳|左頬|右頬|顔|服|衣装)$/u.test(subject)) return false;
  return !cast.some(character => character.name === subject);
}

function normalizeName(value: string): string { return value.normalize('NFKC').trim().toLowerCase(); }
function deduplicateUnresolved(items: CharacterAppearanceCoverageResult['unresolved']): CharacterAppearanceCoverageResult['unresolved'] {
  const seen = new Set<string>();
  return items.filter(item => { const key = `${item.reason}\u0000${item.quote}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function asNonEmptyTuple(values: readonly string[]): [string, ...string[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('Character appearance catalog must not be empty');
  return [first, ...rest];
}
