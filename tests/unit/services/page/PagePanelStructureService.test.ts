import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import type { PanelFrame } from '../../../../src/domain/types/panelFrame.js';
import type {
  ApplyPagePanelStructureInput,
  PagePanelStructureRepository,
  PagePanelStructureResult,
} from '../../../../src/repositories/PagePanelStructureRepository.js';
import { PagePanelStructureService } from '../../../../src/services/page/PagePanelStructureService.js';

const ids = Array.from({ length: 9 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

class FakePagePanelStructureRepository implements PagePanelStructureRepository {
  public lastInput: ApplyPagePanelStructureInput | null = null;
  public lastOrganizationId: string | null = null;

  public async apply(
    _userId: string,
    _pageId: string,
    input: ApplyPagePanelStructureInput,
    organizationId: string | null = null,
  ): Promise<PagePanelStructureResult> {
    this.lastInput = input;
    this.lastOrganizationId = organizationId;
    return {
      panelIds: input.operation.type === 'reorder'
        ? [...input.operation.panelIds]
        : [...input.expectedPanelIds],
      createdPanelId: null,
      layoutTemplateId: input.replacementLayout?.templateId ?? null,
      frames: [] satisfies PanelFrame[],
      balloonReferenceUpdatedCount: 0,
      balloonReferenceClearedCount: 0,
    };
  }
}

describe('PagePanelStructureService', () => {
  it('選択コマの直後への追加では次のコマ数の既定テンプレートを選ぶ', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await service.apply('user-1', 'page-1', {
      expectedPanelIds: ids.slice(0, 3),
      operation: { type: 'insert_after', panelId: ids[1]! },
    });

    expect(repository.lastInput?.operation).toEqual({ type: 'insert_after', panelId: ids[1] });
    expect(repository.lastInput?.replacementLayout?.templateId).toBe('standard_4');
    expect(repository.lastInput?.replacementLayout?.frameDefinitions).toHaveLength(4);
  });

  it.each([[], ids.slice(0, 2), ids.slice(0, 8)].map((expectedPanelIds) => ({ expectedPanelIds })))(
    '選択コマがないか8コマの場合に直後追加を保存前に拒否する: %j',
    async ({ expectedPanelIds }) => {
      const repository = new FakePagePanelStructureRepository();
      const service = new PagePanelStructureService(repository);

      await expect(service.apply('user-1', 'page-1', {
        expectedPanelIds,
        operation: { type: 'insert_after', panelId: expectedPanelIds.length === 8 ? ids[0]! : ids[2]! },
      })).rejects.toBeInstanceOf(ValidationError);
      expect(repository.lastInput).toBeNull();
    },
  );

  it('0コマのページへ追加する場合に1コマ既定テンプレートを選ぶ', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await service.apply('user-1', 'page-1', {
      expectedPanelIds: [],
      operation: { type: 'append' },
    });

    expect(repository.lastInput?.replacementLayout?.templateId).toBe('splash_1');
    expect(repository.lastInput?.replacementLayout?.frameDefinitions).toHaveLength(1);
  });

  it('8コマのページへ追加する場合に保存前に拒否する', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await expect(
      service.apply('user-1', 'page-1', {
        expectedPanelIds: ids.slice(0, 8),
        operation: { type: 'append' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.lastInput).toBeNull();
  });

  it('最後の1コマを削除する場合に保存前に拒否する', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await expect(
      service.apply('user-1', 'page-1', {
        expectedPanelIds: [ids[0]!],
        operation: { type: 'delete', panelId: ids[0]! },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.lastInput).toBeNull();
  });

  it('削除対象が保存済みスナップショットにない場合に拒否する', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await expect(
      service.apply('user-1', 'page-1', {
        expectedPanelIds: ids.slice(0, 2),
        operation: { type: 'delete', panelId: ids[2]! },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('3コマから削除する場合に2コマ既定テンプレートを選ぶ', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);
    const organizationId = '00000000-0000-4000-8000-000000000099';

    await service.apply('user-1', 'page-1', {
      expectedPanelIds: ids.slice(0, 3),
      operation: { type: 'delete', panelId: ids[1]! },
    }, organizationId);

    expect(repository.lastInput?.replacementLayout?.templateId).toBe('climax_2');
    expect(repository.lastInput?.replacementLayout?.frameDefinitions).toHaveLength(2);
    expect(repository.lastOrganizationId).toBe(organizationId);
  });

  it('並び替えに重複IDがある場合に保存前に拒否する', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await expect(
      service.apply('user-1', 'page-1', {
        expectedPanelIds: ids.slice(0, 2),
        operation: { type: 'reorder', panelIds: [ids[0]!, ids[0]!] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('並び替えが現在の全IDと一致しない場合に保存前に拒否する', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await expect(
      service.apply('user-1', 'page-1', {
        expectedPanelIds: ids.slice(0, 2),
        operation: { type: 'reorder', panelIds: [ids[0]!, ids[2]!] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('正しい並び替えの場合にレイアウト置換なしでRepositoryへ渡す', async () => {
    const repository = new FakePagePanelStructureRepository();
    const service = new PagePanelStructureService(repository);

    await service.apply('user-1', 'page-1', {
      expectedPanelIds: ids.slice(0, 3),
      operation: { type: 'reorder', panelIds: [ids[2]!, ids[0]!, ids[1]!] },
    });

    expect(repository.lastInput?.replacementLayout).toBeNull();
    expect(repository.lastInput?.operation).toEqual({
      type: 'reorder',
      panelIds: [ids[2]!, ids[0]!, ids[1]!],
    });
  });
});
