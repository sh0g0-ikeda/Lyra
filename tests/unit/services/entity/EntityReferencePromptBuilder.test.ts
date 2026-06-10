import { describe, expect, it } from 'vitest';
import { EntityReferencePromptBuilder } from '../../../../src/services/entity/EntityReferencePromptBuilder.js';
import type { EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';

const baseContext: EntityReferenceContext = {
  entityId: 'entity-1',
  workId: 'work-1',
  userId: 'user-1',
  entityType: 'character',
  name: 'Yuki',
  freeDescription: 'Quiet transfer student with a hidden violent streak',
  structuredFields: {
    gender_expression: 'female',
    age_range: 'late_teens',
    skin_tone: 'light',
    first_impression: 'quiet_neat',
    standing_style: 'upright_neat',
    default_expression: 'calm_neutral',
    face_shape: 'oval',
    eyebrow_shape: 'soft_arch',
    nose_shape: 'straight',
    mouth_shape: 'thin',
    height: 'short',
    build: 'slender',
    hair: {
      color: 'black',
      length: 'short',
      style: 'straight',
      arrangement: 'short_bob',
      bangs: 'side_swept',
    },
    eyes: {
      color: 'green',
      shape: 'gentle',
      eyelid_type: 'double',
    },
    clothing: {
      category: 'school',
      main_color: 'navy',
      impression: 'practical',
      description: 'standard sailor uniform with a neat silhouette',
    },
    distinguishing_features: 'calm expression with slightly tired eyes',
    art_style: 'manga',
  },
  promptSupplement: 'Keep the silhouette simple and readable',
  status: 'draft',
  referenceSet: {
    entityId: 'entity-1',
    images: [],
    primaryRefId: null,
    status: 'empty',
    updatedAt: new Date('2026-05-25T00:00:00.000Z'),
  },
};

describe('EntityReferencePromptBuilder', () => {
  it('最小入力でも fallback prompt が自然文として破綻しない', () => {
    const builder = new EntityReferencePromptBuilder();

    const prompt = builder.buildGenerationPrompt({
      ...baseContext,
      freeDescription: null,
      structuredFields: {},
      promptSupplement: null,
    });

    expect(prompt).toContain('Create a clean full-body manga character reference of Yuki.');
    expect(prompt).toContain('Show the character in a neutral standing pose.');
    expect(prompt).toContain('Keep exactly one centered subject');
    expect(prompt).not.toContain('{');
    expect(prompt).not.toContain('structured design constraints');
  });

  it('詳細入力を brief に自然文で統合する', () => {
    const builder = new EntityReferencePromptBuilder();

    const brief = builder.buildCompilerBrief({
      ...baseContext,
      structuredFields: {
        ...baseContext.structuredFields,
        character_identity: {
          visual_anchor: 'compact rounded bob and narrow shoulders',
          signature_feature: 'tired green eyes',
          silhouette_keywords: ['compact bob', 'narrow shoulders', 'knee-length sailor skirt'],
        },
        proportions: {
          head_to_body_ratio: 'seven_head',
          shoulder_width: 'narrow',
          leg_length: 'long',
          posture_axis: 'centered and straight, never leaning hard to either side',
        },
        face_detail: {
          eye_size: 'medium',
          eye_angle: 'slightly_downturned',
          pupil_style: 'soft_glossy',
          under_eye_detail: 'tired_shadow',
          mouth_default: 'closed_neutral',
        },
        hair_detail: {
          front_shape: 'split_side',
          side_hair: 'close_to_face',
          back_shape: 'compact_round',
        },
        outfit_detail: {
          collar_shape: 'sailor',
          sleeve_length: 'long',
          skirt_or_pants_shape: 'knee_skirt',
          shoes: 'simple loafers',
          socks_or_legwear: 'dark knee socks',
        },
      },
    });

    expect(brief).toContain('Character visual anchor: compact rounded bob and narrow shoulders');
    expect(brief).toContain('Signature feature: tired green eyes, calm expression with slightly tired eyes');
    expect(brief).toContain('Stable silhouette: compact rounded bob and narrow shoulders, compact bob, narrow shoulders, knee-length sailor skirt, narrow shoulders, long legs, about seven heads tall');
    expect(brief).toContain('Body proportion read: about seven heads tall, narrow shoulders, long legs, centered and straight, never leaning hard to either side');
    expect(brief).toContain('Face detail read:');
    expect(brief).toContain('Hair construction:');
    expect(brief).toContain('Outfit construction:');
    expect(brief).not.toContain('{');
    expect(brief).not.toContain('"visual_anchor"');
  });

  it('抽象的な性格設定を visible design cue に変換する', () => {
    const builder = new EntityReferencePromptBuilder();

    const prompt = builder.buildGenerationPrompt(baseContext);

    expect(prompt).toContain('Her calm expression should carry a faint unsettling tension');
    expect(prompt).toContain('Keep the cue subtle within a calm neutral reference');
  });

  it('抽象的な性格設定があっても禁止要素を勝手に足さない', () => {
    const builder = new EntityReferencePromptBuilder();

    const prompt = builder.buildGenerationPrompt({
      ...baseContext,
      freeDescription: 'Looks kind but emotionally detached, secretly arrogant, with a hidden violent streak',
    }).toLowerCase();

    expect(prompt).not.toContain('sword');
    expect(prompt).not.toContain('gun');
    expect(prompt).not.toContain('explosion');
    expect(prompt).not.toContain('battlefield');
  });

  it('fallback prompt も field-by-field list ではなく art direction になる', () => {
    const builder = new EntityReferencePromptBuilder();

    expect(builder.buildGenerationPrompt(baseContext)).toMatchInlineSnapshot(
      `"Create a clean full-body manga character reference of Yuki, short, slender, late-teen, light skin, female with a quiet, tidy, composed first impression. Show the character in a neutral standing pose, standing upright with neat posture and controlled balance, with a calm neutral expression. The silhouette should stay stable and easy to recognize: standard sailor uniform with a neat silhouette. The face should read clearly with oval face, soft arch eyebrows, straight nose, thin mouth shape, green eyes, gentle eye shape, and double eyelids. The hair design should stay consistent, with black hair, short length, straight texture, a neat short bob, and side-swept bangs. The outfit should be easy to read at a glance, with school uniform, navy, a practical easy-to-move-in silhouette, and standard sailor uniform with a neat silhouette. Her calm expression should carry a faint unsettling tension, as if she is carefully suppressing something dangerous. Keep the cue subtle within a calm neutral reference, without turning it into scene acting or dramatic staging. Additional direction: Keep the silhouette simple and readable. Keep exactly one centered subject, show the full figure from head to toe with both hands and both feet visible, use a plain neutral background, and include no text, watermark, extra props, or extra characters."`,
    );
  });
  it('style anchors are emitted as hard rendering constraints', () => {
    const builder = new EntityReferencePromptBuilder();

    const prompt = builder.buildGenerationPrompt({
      ...baseContext,
      structuredFields: {
        ...baseContext.structuredFields,
        style_reference: {
          title: 'AKIRA',
          notes: '都市感を優先する',
          compiled_brief:
            'Keep the title "AKIRA" explicit as a style constraint, with precise mechanical linework, heavy urban structure, hard-edged shadows, and disciplined environment treatment.',
          anchors: {
            line_quality: 'precise mechanical linework with confident contour control',
            shape_language: 'hard-edged industrial forms with disciplined perspective',
            face_rendering: null,
            eye_rendering: null,
            hair_rendering: null,
            clothing_rendering: 'functional clothing folds with restrained stylization',
            background_rendering: 'dense urban structures with explicit depth and infrastructure detail',
            shading_rendering: 'hard-edged shadow blocks with restrained gradients',
            texture_finish: 'clean ink finish with selective grit in environments',
            motion_treatment: 'controlled action accents without abstract streak overload',
            dialogue_balloon_treatment: null,
            atmosphere: 'tense, heavy urban pressure',
          },
          compiler_provider: 'openai',
          compiler_model: 'gpt-5.4-mini',
          compiler_prompt_version: 'style_ref_v3',
          compiled_at: '2026-05-28T00:00:00.000Z',
        },
      },
    });

    expect(prompt).toContain('Use the named style reference "AKIRA" as a hard rendering constraint.');
    expect(prompt).toContain('Apply these rendering-style anchors through line treatment, shading, finish, and atmosphere only: line quality: precise mechanical linework with confident contour control');
  });

  it('compacts long free text and style reference fields before building generation prompts', () => {
    const builder = new EntityReferencePromptBuilder();
    const longFreeDescription = 'quiet visual identity '.repeat(160);
    const longPromptSupplement = 'keep current saved GUI inputs only '.repeat(120);
    const longStyleBrief = 'disciplined ink rendering with dense urban structure '.repeat(120);
    const longAnchor = 'precise contour rhythm with controlled hard edged shadows '.repeat(30);

    const prompt = builder.buildGenerationPrompt({
      ...baseContext,
      freeDescription: longFreeDescription,
      promptSupplement: longPromptSupplement,
      structuredFields: {
        ...baseContext.structuredFields,
        style_reference: {
          title: 'Long Style',
          notes: 'avoid noisy over-rendering '.repeat(80),
          compiled_brief: longStyleBrief,
          anchors: {
            line_quality: longAnchor,
            shape_language: null,
            face_rendering: null,
            eye_rendering: null,
            hair_rendering: null,
            clothing_rendering: null,
            background_rendering: longAnchor,
            shading_rendering: longAnchor,
            texture_finish: null,
            motion_treatment: null,
            dialogue_balloon_treatment: null,
            atmosphere: longAnchor,
          },
          compiler_provider: 'openai',
          compiler_model: 'gpt-5.4-mini',
          compiler_prompt_version: 'style_ref_v3',
          compiled_at: '2026-05-28T00:00:00.000Z',
        },
      },
    });
    const brief = builder.buildCompilerBrief({
      ...baseContext,
      freeDescription: longFreeDescription,
      promptSupplement: longPromptSupplement,
      structuredFields: {
        ...baseContext.structuredFields,
        style_reference: {
          title: 'Long Style',
          notes: 'avoid noisy over-rendering '.repeat(80),
          compiled_brief: longStyleBrief,
          anchors: {
            line_quality: longAnchor,
            shape_language: null,
            face_rendering: null,
            eye_rendering: null,
            hair_rendering: null,
            clothing_rendering: null,
            background_rendering: longAnchor,
            shading_rendering: longAnchor,
            texture_finish: null,
            motion_treatment: null,
            dialogue_balloon_treatment: null,
            atmosphere: longAnchor,
          },
          compiler_provider: 'openai',
          compiler_model: 'gpt-5.4-mini',
          compiler_prompt_version: 'style_ref_v3',
          compiled_at: '2026-05-28T00:00:00.000Z',
        },
      },
    });

    expect(prompt).toContain('Style interpretation: disciplined ink rendering');
    expect(prompt).toContain('...');
    expect(prompt).not.toContain(longStyleBrief.slice(0, 1200));
    expect(prompt).not.toContain(longPromptSupplement.slice(0, 900));
    expect(brief).not.toContain(longFreeDescription.slice(0, 900));
    expect(brief).not.toContain(longStyleBrief.slice(0, 1200));
    expect(prompt.length).toBeLessThan(5_000);
    expect(brief.length).toBeLessThan(5_000);
  });

  it('画像生成用 prompt では非人間の衣服なし指定を安全な影素材表現に寄せる', () => {
    const builder = new EntityReferencePromptBuilder();
    const context: EntityReferenceContext = {
      ...baseContext,
      entityType: 'nonhuman',
      name: '神託の影（レーマ）',
      freeDescription:
        '白い髪、白い翼をもった真っ黒な人型の影。左の翼は大きめで右の翼は極端に小さい。顔はない。体系は女性より。左腕がない。右手には金色の剣をもっている。衣服は着ていない。全身真っ黒なためアダルト要素ではない。',
      structuredFields: {},
      promptSupplement: null,
    };

    const prompt = builder.buildGenerationPrompt(context);
    const brief = builder.buildCompilerBrief(context);

    expect(prompt).toContain('fully opaque non-human silhouette surface');
    expect(prompt).toContain('shadow material');
    expect(prompt).not.toContain('衣服は着ていない');
    expect(prompt).not.toContain('アダルト');
    expect(brief).toContain('fully opaque non-human silhouette surface');
    expect(brief).not.toContain('衣服は着ていない');
    expect(brief).not.toContain('アダルト');
    expect(brief).not.toContain('both hands visible');
  });
});
