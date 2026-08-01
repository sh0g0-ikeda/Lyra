import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { Balloon, CreateBalloonInput, UpdateBalloonInput } from '../../domain/types/balloon.js';
import type { Panel } from '../../domain/types/panel.js';
import type { PanelFrame } from '../../domain/types/panelFrame.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
import type {
  BalloonContext,
  BalloonRepository,
  PageBalloonContext,
} from '../../repositories/BalloonRepository.js';
import { buildAutoBalloonInputs } from './AutoBalloonLayout.js';

export interface BalloonPanelReader {
  findPanelsByPageIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<Panel[]>;
}

export interface BalloonFrameReader {
  findFramesByPageIdAndUserId(pageId: string, userId: string, organizationId?: string | null): Promise<PanelFrame[]>;
}

export interface BalloonServicePort {
  autoGenerateBalloons(userId: string, pageId: string, organizationId?: string | null): Promise<Balloon[]>;
  createBalloon(
    userId: string,
    pageId: string,
    input: CreateBalloonInput,
    organizationId?: string | null,
  ): Promise<Balloon>;
  listBalloons(userId: string, pageId: string, organizationId?: string | null): Promise<Balloon[]>;
  updateBalloon(
    userId: string,
    balloonId: string,
    input: UpdateBalloonInput,
    organizationId?: string | null,
  ): Promise<Balloon>;
  deleteBalloon(userId: string, balloonId: string, organizationId?: string | null): Promise<void>;
}

export class BalloonService implements BalloonServicePort {
  public constructor(
    private readonly balloonRepository: BalloonRepository,
    private readonly entityReader: EntityReferenceReader,
    private readonly panelReader: BalloonPanelReader,
    private readonly frameReader: BalloonFrameReader,
  ) {}

  public async autoGenerateBalloons(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<Balloon[]> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);

    const panels = await this.panelReader.findPanelsByPageIdAndUserId(pageId, userId, organizationId);
    const frames = await this.frameReader.findFramesByPageIdAndUserId(pageId, userId, organizationId);
    const inputs = buildAutoBalloonInputs(pageContext.dialogueMode, panels, frames);

    const entityIds = [
      ...new Set(
        inputs
          .map((input) => input.speakerEntityId)
          .filter((entityId): entityId is string => entityId !== null),
      ),
    ];
    if (entityIds.length > 0) {
      const count = await this.entityReader.countByIdsAndWorkIdAndUserId(
        entityIds,
        pageContext.workId,
        userId,
        organizationId,
      );
      if (count !== entityIds.length) {
        throw new ValidationError('All auto balloon speaker entities must belong to the page work');
      }
    }

    return this.balloonRepository.replaceBalloonsByPageIdAndUserId(
      pageId,
      userId,
      inputs,
      organizationId,
      panels.map((panel) => panel.id),
    );
  }

  public async createBalloon(
    userId: string,
    pageId: string,
    input: CreateBalloonInput,
    organizationId: string | null = null,
  ): Promise<Balloon> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);
    const panels = await this.panelReader.findPanelsByPageIdAndUserId(pageId, userId, organizationId);
    this.ensurePanelOrderReferenceWithinBounds(input.panelOrderReference, panels.length);
    await this.ensureSpeakerBelongsToWork(input.speakerEntityId, pageContext.workId, userId, organizationId);

    const balloon = await this.balloonRepository.createBalloon(
      pageId,
      userId,
      input,
      organizationId,
      panels.map((panel) => panel.id),
    );
    if (balloon === null) {
      throw new NotFoundError('Page not found');
    }

    return balloon;
  }

  public async listBalloons(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<Balloon[]> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);
    return this.balloonRepository.findBalloonsByPageIdAndUserId(pageId, userId, organizationId);
  }

  public async updateBalloon(
    userId: string,
    balloonId: string,
    input: UpdateBalloonInput,
    organizationId: string | null = null,
  ): Promise<Balloon> {
    const balloonContext = await this.balloonRepository.findBalloonContextByIdAndUserId(
      balloonId,
      userId,
      organizationId,
    );
    if (balloonContext === null) {
      throw new NotFoundError('Balloon not found');
    }

    this.ensureBalloonEditingEnabled(balloonContext);
    const panels = await this.panelReader.findPanelsByPageIdAndUserId(
      balloonContext.pageId,
      userId,
      organizationId,
    );
    this.ensurePanelOrderReferenceWithinBounds(input.panelOrderReference, panels.length);
    await this.ensureSpeakerBelongsToWork(input.speakerEntityId, balloonContext.workId, userId, organizationId);

    const balloon = await this.balloonRepository.updateBalloon(
      balloonId,
      userId,
      input,
      organizationId,
      panels.map((panel) => panel.id),
    );
    if (balloon === null) {
      throw new NotFoundError('Balloon not found');
    }

    return balloon;
  }

  public async deleteBalloon(
    userId: string,
    balloonId: string,
    organizationId: string | null = null,
  ): Promise<void> {
    const balloonContext = await this.balloonRepository.findBalloonContextByIdAndUserId(
      balloonId,
      userId,
      organizationId,
    );
    if (balloonContext === null) {
      throw new NotFoundError('Balloon not found');
    }

    this.ensureBalloonEditingEnabled(balloonContext);

    const deleted = await this.balloonRepository.deleteBalloon(balloonId, userId, organizationId);
    if (!deleted) {
      throw new NotFoundError('Balloon not found');
    }
  }

  private ensureBalloonEditingEnabled(
    context: Pick<PageBalloonContext | BalloonContext, 'status' | 'dialogueMode' | 'hasGeneratedImage'>,
  ): void {
    if (context.status === 'confirmed') {
      throw new ConflictError('Confirmed pages must be reopened before editing balloons');
    }

    if (context.dialogueMode === 'image_baked') {
      throw new ConflictError('Balloon editing is disabled for image_baked pages');
    }

    if (!context.hasGeneratedImage) {
      throw new ConflictError('Page must have a generated image before editing balloons');
    }
  }

  private ensurePanelOrderReferenceWithinBounds(
    panelOrderReference: number | null | undefined,
    panelCount: number,
  ): void {
    if (panelOrderReference === undefined || panelOrderReference === null) {
      return;
    }

    if (panelOrderReference > panelCount) {
      throw new ValidationError('panel_order_reference must refer to an existing panel');
    }
  }

  private async ensureSpeakerBelongsToWork(
    speakerEntityId: string | null | undefined,
    workId: string,
    userId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (speakerEntityId === undefined || speakerEntityId === null) {
      return;
    }

    const count = await this.entityReader.countByIdsAndWorkIdAndUserId(
      [speakerEntityId],
      workId,
      userId,
      organizationId,
    );
    if (count !== 1) {
      throw new ValidationError('Speaker entity must belong to the same work');
    }
  }
}
