import { describe, expect, it } from 'vitest';
import { canEditPageStatus } from '@/domain/pageEditing';
describe('ページ確定UIを使わない編集', () => {
  it('明示書込の原子的再編集を提供するserverだけで確定済みページを編集する', () => {
    expect(canEditPageStatus('confirmed', true)).toBe(true);
    expect(canEditPageStatus('confirmed', false)).toBe(false);
    expect(canEditPageStatus('confirmed', undefined)).toBe(false);
  });
  it('生成中は能力にかかわらず編集できず通常の下書きは編集できる', () => {
    expect(canEditPageStatus('generating', true)).toBe(false);
    expect(canEditPageStatus('editing', false)).toBe(true);
    expect(canEditPageStatus('designing', false)).toBe(true);
  });
});
