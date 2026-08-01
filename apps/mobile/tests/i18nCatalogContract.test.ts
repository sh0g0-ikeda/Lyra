import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { componentTranslations } from '@/lib/i18nComponentMessages';
import { generatedTranslations } from '@/lib/i18nGenerated';
import { screenTranslations } from '@/lib/i18nScreenMessages';
import { sharedTranslations } from '@/lib/i18nSharedMessages';

const sourceRoot = path.resolve(__dirname, '../src');

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(resolved);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [resolved] : [];
  });

describe('Mobile i18n catalog contract', () => {
  it('UIソースに日英の直書き選択を残さない', () => {
    const violations = collectSourceFiles(sourceRoot)
      .filter((filePath) => !filePath.endsWith(`${path.sep}i18n.ts`))
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return source.includes('pickText(') || /\bpickText\b/.test(source)
          ? [path.relative(sourceRoot, filePath)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it('各翻訳カタログの日英キーが完全に一致する', () => {
    for (const catalog of [
      generatedTranslations,
      componentTranslations,
      screenTranslations,
      sharedTranslations
    ]) {
      expect(Object.keys(catalog.ja).sort()).toEqual(Object.keys(catalog.en).sort());
    }
  });

  it('表示文をlanguage条件で直書きしない', () => {
    const violations = collectSourceFiles(sourceRoot)
      .filter((filePath) => !filePath.includes(`${path.sep}lib${path.sep}i18n`))
      .flatMap((filePath) => findDirectBilingualLiterals(filePath));

    expect(violations).toEqual([]);
  });

  it('キャラクター選択肢は日本語ラベルの不足で英語へフォールバックしない', () => {
    const sourceFile = parseSourceFile(path.join(sourceRoot, 'screens/CharactersScreen.tsx'));
    const japaneseLabels = collectObjectKeys(sourceFile, 'japaneseOptionLabels');
    const optionValues = collectOptionSetValues(sourceFile);

    expect(
      optionValues.filter((value) => value.length > 0 && !japaneseLabels.has(value))
    ).toEqual([]);
  });
});

const findDirectBilingualLiterals = (filePath: string): string[] => {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isConditionalExpression(node)
      && node.condition.getText(sourceFile).includes('language')
      && node.condition.getText(sourceFile).includes('ja')
      && (isDisplayLiteral(node.whenTrue) || isDisplayLiteral(node.whenFalse))
      && !isAllowedLocaleOrSeparator(node.whenTrue, node.whenFalse)
    ) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${path.relative(sourceRoot, filePath)}:${location.line + 1}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const isDisplayLiteral = (node: ts.Expression): boolean =>
  ts.isStringLiteral(node)
  || ts.isNoSubstitutionTemplateLiteral(node)
  || ts.isTemplateExpression(node);

const isAllowedLocaleOrSeparator = (left: ts.Expression, right: ts.Expression): boolean => {
  if (!ts.isStringLiteralLike(left) || !ts.isStringLiteralLike(right)) {
    return false;
  }
  const values = new Set([left.text, right.text]);
  return (
    (values.has('ja-JP') && values.has('en-US'))
    || (values.has('、') && values.has(', '))
  );
};

const parseSourceFile = (filePath: string): ts.SourceFile =>
  ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

const collectObjectKeys = (sourceFile: ts.SourceFile, variableName: string): Set<string> => {
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
      && node.initializer !== undefined
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key = propertyNameText(property.name);
          if (key !== null) {
            keys.add(key);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
};

const collectOptionSetValues = (sourceFile: ts.SourceFile): string[] => {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'optionSet'
      && node.arguments.length === 1
      && ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      for (const element of node.arguments[0].elements) {
        if (
          ts.isArrayLiteralExpression(element)
          && element.elements.length > 0
          && ts.isStringLiteralLike(element.elements[0])
        ) {
          values.push(element.elements[0].text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
};

const propertyNameText = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};
