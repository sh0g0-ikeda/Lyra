import { describe, expect, it } from 'vitest';
import { buildAutoBalloonInputs } from '../../../../src/services/page/AutoBalloonLayout.js';
import type { Panel } from '../../../../src/domain/types/panel.js';
import type { PanelFrame } from '../../../../src/domain/types/panelFrame.js';

describe('AutoBalloonLayout', () => {
  it('tiny frame でも全 balloon 種別が frame 内に収まる', () => {
    const panels: Panel[] = [
      {
        id: 'panel-1',
        pageId: 'page-1',
        order: 1,
        panelRole: 'action',
        panelSize: 'standard',
        situationText: 'A tight exchange.',
        entities: [],
        composition: {
          source: 'ai_auto',
          galleryItemId: null,
          compositionPrompt: null,
          shotType: null,
          angle: null,
          customNote: null,
        },
        dialogueInPanel: false,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'Stop!',
            type: 'shout',
            position: 'top',
          },
          {
            entityId: null,
            text: 'Bam',
            type: 'sfx',
            position: 'center',
          },
          {
            entityId: 'entity-1',
            text: '...wait',
            type: 'whisper',
            position: 'bottom',
          },
        ],
        sfxText: null,
        backgroundNote: null,
        panelNotes: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const frames: PanelFrame[] = [
      {
        id: 'frame-1',
        pageId: 'page-1',
        panelId: 'panel-1',
        vertices: [
          { x: 0.1, y: 0.12 },
          { x: 0.19, y: 0.12 },
          { x: 0.19, y: 0.24 },
          { x: 0.1, y: 0.24 },
        ],
        borderStyle: 'solid',
        borderWidth: 2,
        borderColor: '#000000',
        zIndex: 1,
        readingOrder: 1,
      },
    ];

    const balloons = buildAutoBalloonInputs('balloon_only', panels, frames);

    expect(balloons).toHaveLength(3);
    for (const balloon of balloons) {
      expect(balloon.position.width <= 0.09 * 0.88 + 1e-6).toBe(true);
      expect(balloon.position.height <= 0.12 * 0.88 + 1e-6).toBe(true);
    }
  });

  it('thoughtは話者がコマ内でもspeech tailを作らない', () => {
    const panel = buildPanel({
      dialogue: [{ entityId: 'entity-1', text: 'どうする。', type: 'thought', position: 'top' }],
      entities: [buildAssignment('entity-1', 'left')],
    });

    const [balloon] = buildAutoBalloonInputs('balloon_only', [panel], [buildFrame()]);

    expect(balloon?.speakerEntityId).toBe('entity-1');
    expect(balloon?.tail).toBeNull();
  });

  it('off-panel speechは実際の話者IDを保持し見えるlistenerへtailを作らない', () => {
    const panel = buildPanel({
      dialogue: [{ entityId: 'entity-off', text: 'こちらへ。', type: 'speech', position: 'top' }],
      entities: [buildAssignment('entity-visible', 'center')],
    });

    const [balloon] = buildAutoBalloonInputs('balloon_only', [panel], [buildFrame()]);

    expect(balloon?.speakerEntityId).toBe('entity-off');
    expect(balloon?.tail).toBeNull();
  });

  it('visible speechはtail先を話者の配置側へ向ける', () => {
    const panel = buildPanel({
      dialogue: [{ entityId: 'entity-1', text: '右だ。', type: 'speech', position: 'top' }],
      entities: [buildAssignment('entity-1', 'right')],
    });

    const [balloon] = buildAutoBalloonInputs('balloon_only', [panel], [buildFrame()]);

    expect(balloon?.tail).not.toBeNull();
    expect(balloon?.tail?.tipX).toBeCloseTo(0.75);
    expect(balloon?.tail?.tipX).not.toBeCloseTo(0.5);
  });
});

function buildPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: 'panel-1',
    pageId: 'page-1',
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: null,
    entities: [],
    composition: {
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: false,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    createdAt: new Date('2026-09-14T00:00:00.000Z'),
    updatedAt: new Date('2026-09-14T00:00:00.000Z'),
    ...overrides,
  };
}

function buildAssignment(
  entityId: string,
  position: Panel['entities'][number]['position'],
): Panel['entities'][number] {
  return {
    entityId,
    role: 'primary',
    expression: 'calm',
    customExpression: null,
    action: 'standing_firm',
    customAction: null,
    position,
    facingDirection: null,
    effectNote: null,
    stateId: null,
  };
}

function buildFrame(): PanelFrame {
  return {
    id: 'frame-1',
    pageId: 'page-1',
    panelId: 'panel-1',
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    borderStyle: 'solid',
    borderWidth: 2,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: 1,
  };
}
