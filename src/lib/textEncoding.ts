const suspiciousMojibakePattern = /[ÃÂãæåçéèêëîïðñòóôõöùúûüýþÿ]/u;
const japanesePattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々〆ヵヶー]/u;
const replacementCharacterPattern = /\uFFFD/u;

export function normalizePossiblyMojibake(value: string): string {
  if (typeof value !== 'string') {
    return '';
  }

  if (value.length === 0 || !suspiciousMojibakePattern.test(value)) {
    return value;
  }

  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  if (repaired.length === 0 || replacementCharacterPattern.test(repaired)) {
    return value;
  }

  const originalScore = scoreJapaneseReadability(value);
  const repairedScore = scoreJapaneseReadability(repaired);
  return repairedScore > originalScore ? repaired : value;
}

export function normalizeNullableText(value: string | null): string | null {
  return value === null ? null : normalizePossiblyMojibake(value);
}

function scoreJapaneseReadability(value: string): number {
  let score = 0;

  for (const character of value) {
    if (japanesePattern.test(character)) {
      score += 3;
      continue;
    }

    if (suspiciousMojibakePattern.test(character)) {
      score -= 2;
      continue;
    }

    if (/[\w\s.,!?'"():;/\-]/u.test(character)) {
      score += 1;
    }
  }

  return score;
}
