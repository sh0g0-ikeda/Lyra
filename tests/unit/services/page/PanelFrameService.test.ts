import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type {
  PageLayoutFrameUpdate,
  PanelFrame,
  UpsertPanelFrameInput,
} from '../../../../src/domain/types/panelFrame.js';
import type {
  PageFrameContext,
  PanelFrameRepository,
} from '../../../../src/repositories/PanelFrameRepository.js';
import { PanelFrameService } from '../../../../src/services/page/PanelFrameService.js';

const userId = 'user-1';
const pageId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const panelId = '33333333-3333-4333-8333-333333333333';
const frame = buildFrameInput();

class FakePanelFrameRepository implements PanelFrameRepository {
  public pageContext: PageFrameContext | null = { pageId, workId };
  public ownedPanelIds = [panelId];
  public savedFrames: UpsertPanelFrameInput[] | null = null;
  public savedLayoutUpdate: PageLayoutFrameUpdate | null = null;

  public async findPageContextByIdAndUserId(
    requestedPageId: string,
    _userId: string,
  ): Promise<PageFrameContext | null> {
    return this.pageContext === null ? null : { ...this.pageContext, pageId: requestedPageId };
  }

  public async findPanelIdsByPageIdAndUserId(
    _requestedPageId: string,
    _userId: string,
    _panelIds: string[],
  ): Promise<string[]> {
    return this.ownedPanelIds;
  }

  public async findFramesByPageIdAndUserId(
    requestedPageId: string,
    _userId: string,
  ): Promise<PanelFrame[]> {
    return [buildPanelFrame({ pageId: requestedPageId })];
  }

  public async replaceFramesByPageIdAndUserId(
    requestedPageId: string,
    _userId: string,
    frames: UpsertPanelFrameInput[],
    layoutUpdate?: PageLayoutFrameUpdate,
  ): Promise<PanelFrame[]> {
    this.savedFrames = frames;
    this.savedLayoutUpdate = layoutUpdate ?? null;
    return frames.map((input) => buildPanelFrame({ pageId: requestedPageId, panelId: input.panelId }));
  }
}

describe('PanelFrameService', () => {
  it('ページ所有者の場合にPanelFrameを保存できる', async () => {
    const repository = new FakePanelFrameRepository();
    const service = new PanelFrameService(repository);

    const frames = await service.replacePageFrames(userId, pageId, [frame]);

    expect(repository.savedFrames?.[0]).toMatchObject({ panelId });
    expect(repository.savedLayoutUpdate).toMatchObject({
      type: 'custom',
      panelCount: 1,
      frameDefinitions: [expect.objectContaining({ panelId })],
    });
    expect(frames[0]?.pageId).toBe(pageId);
  });

  it('ページが存在しない場合にNOT_FOUNDになる', async () => {
    const repository = new FakePanelFrameRepository();
    repository.pageContext = null;
    const service = new PanelFrameService(repository);

    await expect(service.listPageFrames(userId, pageId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('指定panel_idがページに属さない場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelFrameRepository();
    repository.ownedPanelIds = [];
    const service = new PanelFrameService(repository);

    await expect(service.replacePageFrames(userId, pageId, [frame])).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('テンプレートを適用してlayout_config更新情報を保存できる', async () => {
    const repository = new FakePanelFrameRepository();
    const service = new PanelFrameService(repository);

    const result = await service.applyTemplate(userId, pageId, 'standard_4');

    expect(result).toMatchObject({
      templateId: 'standard_4',
      panelCount: 4,
    });
    expect(repository.savedFrames).toHaveLength(4);
    expect(repository.savedFrames?.[0]).toMatchObject({
      panelId: null,
      readingOrder: 1,
    });
    expect(repository.savedLayoutUpdate).toMatchObject({
      type: 'template',
      templateId: 'standard_4',
      panelCount: 4,
    });
    expect(repository.savedLayoutUpdate?.frameDefinitions).toHaveLength(4);
  });
});

function buildFrameInput(overrides: Partial<UpsertPanelFrameInput> = {}): UpsertPanelFrameInput {
  return {
    panelId,
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0, y: 0.5 },
    ],
    borderStyle: 'solid',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: 1,
    ...overrides,
  };
}

function buildPanelFrame(overrides: Partial<PanelFrame> = {}): PanelFrame {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    pageId,
    ...buildFrameInput(),
    ...overrides,
  };
}
