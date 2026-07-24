import { describe, expect, it } from 'vitest';
import type {
  ApplyPageLayoutTemplateInput,
  PageLayoutRepository,
} from '../../../../src/repositories/PageLayoutRepository.js';
import { PageLayoutService } from '../../../../src/services/page/PageLayoutService.js';

class FakePageLayoutRepository implements PageLayoutRepository {
  public lastInput: ApplyPageLayoutTemplateInput | null = null;

  public async applyTemplateAndSyncPanels(
    _userId: string,
    _pageId: string,
    input: ApplyPageLayoutTemplateInput,
  ) {
    this.lastInput = input;

    return {
      templateId: input.templateId,
      panelCount: input.targetPanelCount,
      createdPanelCount: 0,
      deletedPanelCount: 0,
      frames: [],
    };
  }
}

describe('PageLayoutService', () => {
  it('テンプレートのコマ数とフレーム定義をRepositoryへ渡す', async () => {
    const repository = new FakePageLayoutRepository();
    const service = new PageLayoutService(repository);

    const result = await service.applyTemplate('user-1', 'page-1', {
      templateId: 'top_wide_3',
    });

    expect(result).toMatchObject({
      templateId: 'top_wide_3',
      panelCount: 3,
    });
    expect(repository.lastInput).toMatchObject({
      templateId: 'top_wide_3',
      targetPanelCount: 3,
    });
    expect(repository.lastInput?.frameDefinitions).toHaveLength(3);
  });
});
