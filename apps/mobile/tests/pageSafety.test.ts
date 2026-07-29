import { describe, expect, it } from 'vitest';

import { createSafeLayoutTemplatePayload, selectExcessPanels } from '@/domain/pageSafety';

describe('pageSafety', () => {
  it('テンプレート適用で暗黙のコマ削除を許可しない', () => {
    expect(createSafeLayoutTemplatePayload('standard_4')).toEqual({
      template_id: 'standard_4',
      allow_panel_truncation: false
    });
  });

  it('削除が必要な末尾コマを現在の順序から特定する', () => {
    const panels = [{ order: 3 }, { order: 1 }, { order: 2 }];

    expect(selectExcessPanels(panels, 2)).toEqual([{ order: 3 }]);
  });
});
