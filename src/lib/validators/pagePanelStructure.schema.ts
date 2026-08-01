import { z } from 'zod';

const uniquePanelIdsSchema = z
  .array(z.string().uuid())
  .max(8)
  .superRefine((panelIds, context) => {
    if (new Set(panelIds).size !== panelIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Panel ids must not contain duplicates',
      });
    }
  });

const appendOperationSchema = z.object({ type: z.literal('append') }).strict();
const deleteOperationSchema = z
  .object({
    type: z.literal('delete'),
    panel_id: z.string().uuid(),
  })
  .strict();
const reorderOperationSchema = z
  .object({
    type: z.literal('reorder'),
    panel_ids: uniquePanelIdsSchema.min(1),
  })
  .strict();

export const applyPagePanelStructureBodySchema = z
  .object({
    expected_panel_ids: uniquePanelIdsSchema,
    operation: z.discriminatedUnion('type', [
      appendOperationSchema,
      deleteOperationSchema,
      reorderOperationSchema,
    ]),
  })
  .strict();
