import { z } from 'zod';

const nullableText100 = z.string().trim().min(1).max(100).nullable();

const panelEntityAssignmentSchema = z
  .object({
    entity_id: z.string().uuid(),
    role: z.enum(['primary', 'secondary', 'background']),
    expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
    custom_expression: nullableText100.optional().default(null),
    action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
    custom_action: nullableText100.optional().default(null),
    position: z.enum(['left', 'center', 'right', 'background']),
    state_id: z.string().uuid().nullable().optional().default(null),
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.expression === 'custom' && assignment.custom_expression === null) {
      context.addIssue({
        code: 'custom',
        message: 'custom_expression is required when expression is custom',
        path: ['custom_expression'],
      });
    }

    if (assignment.action === 'custom' && assignment.custom_action === null) {
      context.addIssue({
        code: 'custom',
        message: 'custom_action is required when action is custom',
        path: ['custom_action'],
      });
    }
  });

export const panelEntityAssignmentUuidParamSchema = z.string().uuid();

export const replacePanelEntityAssignmentsBodySchema = z
  .object({
    entities: z.array(panelEntityAssignmentSchema).max(20),
  })
  .strict();
