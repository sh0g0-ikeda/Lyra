import { z } from 'zod';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../domain/constants/panelFrameTemplates.js';

const borderColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const borderStyleSchema = z.enum(['solid', 'dashed', 'none']);
const vertexSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

const panelFrameBodySchema = z
  .object({
    id: z.string().uuid().optional(),
    panel_id: z.string().uuid().nullable().optional(),
    vertices: z.array(vertexSchema).length(4),
    border_style: borderStyleSchema.default('solid'),
    border_width: z.number().int().min(0).max(20).default(3),
    border_color: borderColorSchema.default('#000000'),
    z_index: z.number().int().min(0).max(1000).default(1),
    reading_order: z.number().int().min(1).max(1000),
  })
  .strict();

export const panelFrameUuidParamSchema = z.string().uuid();

export const replacePanelFramesBodySchema = z
  .object({
    frames: z.array(panelFrameBodySchema).min(1).max(20),
  })
  .strict()
  .superRefine((body, context) => {
    const readingOrders = new Set<number>();
    const frameIds = new Set<string>();

    body.frames.forEach((frame, index) => {
      if (readingOrders.has(frame.reading_order)) {
        context.addIssue({
          code: 'custom',
          message: 'reading_order must be unique within the page',
          path: ['frames', index, 'reading_order'],
        });
      }
      readingOrders.add(frame.reading_order);

      if (frame.id === undefined) {
        return;
      }

      if (frameIds.has(frame.id)) {
        context.addIssue({
          code: 'custom',
          message: 'id must be unique within the request',
          path: ['frames', index, 'id'],
        });
      }
      frameIds.add(frame.id);
    });
  });

export const applyPanelFrameTemplateBodySchema = z
  .object({
    template_id: z.enum(PANEL_FRAME_TEMPLATE_IDS),
  })
  .strict();
