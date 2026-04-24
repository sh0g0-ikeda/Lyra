import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
import type { BalloonRepository } from '../../repositories/BalloonRepository.js';
import type { Balloon, CreateBalloonInput, UpdateBalloonInput } from '../../domain/types/balloon.js';

export interface BalloonServicePort {
  createBalloon(userId: string, pageId: string, input: CreateBalloonInput): Promise<Balloon>;
  listBalloons(userId: string, pageId: string): Promise<Balloon[]>;
  updateBalloon(userId: string, balloonId: string, input: UpdateBalloonInput): Promise<Balloon>;
  deleteBalloon(userId: string, balloonId: string): Promise<void>;
}

export class BalloonService implements BalloonServicePort {
  public constructor(
    private readonly balloonRepository: BalloonRepository,
    private readonly entityReader: EntityReferenceReader,
  ) {}

  public async createBalloon(userId: string, pageId: string, input: CreateBalloonInput): Promise<Balloon> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext.dialogueMode, pageContext.hasGeneratedImage);
    await this.ensureSpeakerBelongsToWork(input.speakerEntityId, pageContext.workId, userId);

    return this.balloonRepository.createBalloon(pageId, input);
  }

  public async listBalloons(userId: string, pageId: string): Promise<Balloon[]> {
    const pageContext = await this.balloonRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    this.ensureBalloonEditingEnabled(pageContext.dialogueMode, pageContext.hasGeneratedImage);
    return this.balloonRepository.findBalloonsByPageIdAndUserId(pageId, userId);
  }

  public async updateBalloon(userId: string, balloonId: string, input: UpdateBalloonInput): Promise<Balloon> {
    const balloonContext = await this.balloonRepository.findBalloonContextByIdAndUserId(balloonId, userId);
    if (balloonContext === null) {
      throw new NotFoundError('Balloon not found');
    }

    this.ensureBalloonEditingEnabled(balloonContext.dialogueMode, balloonContext.hasGeneratedImage);
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

    this.ensureBalloonEditingEnabled(balloonContext.dialogueMode, balloonContext.hasGeneratedImage);

    const deleted = await this.balloonRepository.deleteBalloon(balloonId, userId);
    if (!deleted) {
      throw new NotFoundError('Balloon not found');
    }
  }

  private ensureBalloonEditingEnabled(dialogueMode: 'image_baked' | 'balloon_only' | 'mixed', hasGeneratedImage: boolean): void {
    if (dialogueMode === 'image_baked') {
      throw new ConflictError('Balloon editing is disabled for image_baked pages');
    }

    if (!hasGeneratedImage) {
      throw new ConflictError('Page must have a generated image before editing balloons');
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
