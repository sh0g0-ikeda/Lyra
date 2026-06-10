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
  findPanelsByPageIdAndUserId(pageId: string, userId: string): Promise<Panel[]>;
}

export interface BalloonFrameReader {
  findFramesByPageIdAndUserId(pageId: string, userId: string): Promise<PanelFrame[]>;
}

export interface BalloonServicePort {
  autoGenerateBalloons(userId: string, pageId: string): Promise<Balloon[]>;
  createBalloon(userId: string, pageId: string, input: CreateBalloonInput): Promise<Balloon>;
  listBalloons(userId: string, pageId: string): Promise<Balloon[]>;
  updateBalloon(userId: string, balloonId: string, input: UpdateBalloonInput): Promise<Balloon>;
  deleteBalloon(userId: string, balloonId: string): Promise<void>;
}

export class BalloonService implements BalloonServicePort {
  public constructor(
    private readonly balloonRepository: BalloonRepository,
    private readonly entityReader: EntityReferenceReader,
    private readonly panelReader: BalloonPanelReader,
    private readonly frameReader: BalloonFrameReader,
  ) {}

  public async autoGenerateBalloons(userId: string, pageId: string): Promise<Balloon[]> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);

    const panels = await this.panelReader.findPanelsByPageIdAndUserId(pageId, userId);
    const frames = await this.frameReader.findFramesByPageIdAndUserId(pageId, userId);
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
      );
      if (count !== entityIds.length) {
        throw new ValidationError('All auto balloon speaker entities must belong to the page work');
      }
    }

    return this.balloonRepository.replaceBalloonsByPageIdAndUserId(pageId, userId, inputs);
  }

  public async createBalloon(userId: string, pageId: string, input: CreateBalloonInput): Promise<Balloon> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);
    this.ensurePanelOrderReferenceWithinBounds(input.panelOrderReference, pageContext.panelCount);
    await this.ensureSpeakerBelongsToWork(input.speakerEntityId, pageContext.workId, userId);

    const balloon = await this.balloonRepository.createBalloon(pageId, userId, input);
    if (balloon === null) {
      throw new NotFoundError('Page not found');
    }

    return balloon;
  }

  public async listBalloons(userId: string, pageId: string): Promise<Balloon[]> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext);
    return this.balloonRepository.findBalloonsByPageIdAndUserId(pageId, userId);
  }

  public async updateBalloon(userId: string, balloonId: string, input: UpdateBalloonInput): Promise<Balloon> {
    const balloonContext = await this.balloonRepository.findBalloonContextByIdAndUserId(balloonId, userId);
    if (balloonContext === null) {
      throw new NotFoundError('Balloon not found');
    }

    this.ensureBalloonEditingEnabled(balloonContext);
    this.ensurePanelOrderReferenceWithinBounds(input.panelOrderReference, balloonContext.panelCount);
    await this.ensureSpeakerBelongsToWork(input.speakerEntityId, balloonContext.workId, userId);

    const balloon = await this.balloonRepository.updateBalloon(balloonId, userId, input);
    if (balloon === null) {
      throw new NotFoundError('Balloon not found');
    }

    return balloon;
  }

  public async deleteBalloon(userId: string, balloonId: string): Promise<void> {
    const balloonContext = await this.balloonRepository.findBalloonContextByIdAndUserId(balloonId, userId);
    if (balloonContext === null) {
      throw new NotFoundError('Balloon not found');
    }

    this.ensureBalloonEditingEnabled(balloonContext);

    const deleted = await this.balloonRepository.deleteBalloon(balloonId, userId);
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
  ): Promise<void> {
    if (speakerEntityId === undefined || speakerEntityId === null) {
      return;
    }

    const count = await this.entityReader.countByIdsAndWorkIdAndUserId([speakerEntityId], workId, userId);
    if (count !== 1) {
      throw new ValidationError('Speaker entity must belong to the same work');
    }
  }
}
