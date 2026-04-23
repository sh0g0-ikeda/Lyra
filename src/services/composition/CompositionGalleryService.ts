import type {
  CompositionGalleryItem,
  CompositionGalleryQuery,
} from '../../domain/types/composition.js';
import type { CompositionGalleryRepository } from '../../repositories/CompositionGalleryRepository.js';

export type { CompositionGalleryItem, CompositionGalleryQuery };

export interface CompositionGalleryServicePort {
  listCompositions(query: CompositionGalleryQuery): Promise<CompositionGalleryItem[]>;
}

export class CompositionGalleryService implements CompositionGalleryServicePort {
  public constructor(private readonly compositionGalleryRepository: CompositionGalleryRepository) {}

  public async listCompositions(query: CompositionGalleryQuery): Promise<CompositionGalleryItem[]> {
    return this.compositionGalleryRepository.findMany(query);
  }
}
