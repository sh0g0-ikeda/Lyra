export interface CompositionGalleryItem {
  id: string;
  name: string;
  category: string;
  entityCount: number;
  previewS3Key: string;
  previewCdnUrl: string;
  compositionPrompt: string;
  shotType: string;
  angle: string;
  tags: string[];
  createdAt: Date;
}

export interface CompositionGalleryQuery {
  category: string | null;
  entityCount: number | null;
  tag: string | null;
  limit: number;
}
