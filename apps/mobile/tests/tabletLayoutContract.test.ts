import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(__dirname, '..');

describe('iPadレイアウト契約', () => {
  it('全画面モーダルでも左右を含むSafe Areaを使う', () => {
    const files = [
      'src/components/ImagePreviewModal.tsx',
      'src/components/OrganizationCollectionModal.tsx',
      'src/components/StoryHierarchySheet.tsx',
      'src/components/UnsavedChangesResolutionDialog.tsx'
    ];

    for (const file of files) {
      const source = readFileSync(resolve(mobileRoot, file), 'utf8');
      expect(source, file).not.toContain("edges={['top', 'bottom']}");
      expect(source, file).toContain("edges={['top', 'right', 'bottom', 'left']}");
    }
  });
});
