import { z } from 'zod';

/** An absent/invalid capability must never authorize an image-destroying legacy overwrite. */
export const pageSkeletonCapabilitiesSchema = z.object({
  preserve_generated_images: z.boolean(),
}).strict();
export type PageSkeletonCapabilities = z.infer<typeof pageSkeletonCapabilitiesSchema>;
