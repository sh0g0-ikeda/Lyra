import { describe, expect, it } from 'vitest';
import {
  pageAutofillResponseSchema,
  pageJobAcceptedResponseSchema,
  pageLayoutTemplateResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../../src/domain/constants/panelFrameTemplates.js';

const validFrame = {
  id: 'frame-1',
  page_id: 'page-1',
  panel_id: null,
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  border_style: 'solid',
  border_width: 3,
  border_color: '#000000',
  z_index: 1,
  reading_order: 0,
};

describe('Page command response contract', () => {
  it('job受付・layout同期・compiler metadataのnull境界を受理する', () => {
    expect(pageJobAcceptedResponseSchema.safeParse({ job_id: 'job-1' }).success).toBe(true);
    expect(
      pageLayoutTemplateResponseSchema.safeParse({
        template_id: 'standard_4',
        panel_count: 4,
        created_panel_count: 0,
        deleted_panel_count: 0,
        frames: [validFrame],
      }).success,
    ).toBe(true);
    expect(
      pageAutofillResponseSchema.safeParse({
        updated_panel_count: 0,
        filled_field_count: 0,
        compiler_used: false,
        compiler_provider: 'fallback',
        compiler_model: null,
        compiler_prompt_version: null,
        compiler_error: null,
      }).success,
    ).toBe(true);
    for (const templateId of PANEL_FRAME_TEMPLATE_IDS) {
      expect(
        pageLayoutTemplateResponseSchema.safeParse({
          template_id: templateId,
          panel_count: 0,
          created_panel_count: 0,
          deleted_panel_count: 0,
          frames: [],
        }).success,
      ).toBe(true);
    }
  });

  it('空job ID・未知template/provider・負数集計を拒否する', () => {
    expect(pageJobAcceptedResponseSchema.safeParse({ job_id: '' }).success).toBe(false);
    expect(
      pageLayoutTemplateResponseSchema.safeParse({
        template_id: 'unknown_template',
        panel_count: 4,
        created_panel_count: 0,
        deleted_panel_count: 0,
        frames: [validFrame],
      }).success,
    ).toBe(false);
    expect(
      pageLayoutTemplateResponseSchema.safeParse({
        template_id: 'standard_4',
        panel_count: -1,
        created_panel_count: 0,
        deleted_panel_count: 0,
        frames: [validFrame],
      }).success,
    ).toBe(false);
    expect(
      pageAutofillResponseSchema.safeParse({
        updated_panel_count: 0,
        filled_field_count: 0,
        compiler_used: false,
        compiler_provider: 'legacy',
        compiler_model: null,
        compiler_prompt_version: null,
        compiler_error: null,
      }).success,
    ).toBe(false);
  });
});
