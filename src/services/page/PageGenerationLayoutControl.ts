import {
  PANEL_FRAME_TEMPLATES,
  getPanelFrameTemplate,
  getPanelFrameTemplateEditorialGuide,
} from '../../domain/constants/panelFrameTemplates.js';
import type { PanelFrameBorderStyle, PanelFrameTemplateId, PanelFrameVertex } from '../../domain/types/panelFrame.js';

export const PAGE_LAYOUT_CONTROL_VERSION = 'page_layout_v1';
export const JAPANESE_MANGA_READING_ORDER_LOCK =
  'Japanese manga physical reading order is mandatory: panel 1 is the upper-right or rightmost top entry; follow numbered panels generally right-to-left and downward toward the lower-left, never western left-to-right.';
const COORDINATE_SYSTEM =
  'Coordinates describe the portrait page: origin (0,0) is the upper-left; x increases left-to-right, y increases top-to-bottom; (1,1) is the lower-right.';
const MAX_LAYOUT_FRAMES = 20;

export interface PageLayoutControlFrame {
  readingOrder: number;
  vertices: PanelFrameVertex[];
  borderStyle: PanelFrameBorderStyle;
  borderWidth: number;
  borderColor: string;
  physicalPlacement: string;
}

export interface PageGenerationLayoutControl {
  version: typeof PAGE_LAYOUT_CONTROL_VERSION;
  source: 'template' | 'custom' | 'ai_generated' | 'ai_auto';
  templateId: PanelFrameTemplateId | null;
  frames: PageLayoutControlFrame[];
  detailedInstruction: string;
  finalSuffix: string;
}

// A single resolved map binds prose and image input. Incomplete legacy layouts
// must not become a different, partially parsed layout or a new generation error.
export function resolvePageGenerationLayoutControl(
  layoutConfig: Record<string, unknown>,
  actualPanelCount: number,
): PageGenerationLayoutControl | null {
  const source = layoutConfig.type;
  if (source !== 'template' && source !== 'custom' && source !== 'ai_generated' && source !== 'ai_auto') return null;
  let templateId: PanelFrameTemplateId | null = null;
  let definitions: unknown = layoutConfig.frame_definitions;
  let description = 'Follow the uploaded layout reference image exactly for panel borders, gutter spacing, and reading order.';
  if (source === 'template') {
    const id = layoutConfig.template_id;
    if (typeof id !== 'string' || !Object.hasOwn(PANEL_FRAME_TEMPLATES, id)) return null;
    templateId = id as PanelFrameTemplateId;
    const template = getPanelFrameTemplate(templateId);
    if (template.panelCount !== actualPanelCount) return null;
    definitions = template.frames;
    description = `Use the ${template.id} template with ${template.panelCount} panels. ${getPanelFrameTemplateEditorialGuide(templateId).geometry}`;
  }
  const frames = normalizeFrames(definitions, actualPanelCount);
  if (frames === null) return null;
  const positions = frames.map((frame) => `P${frame.readingOrder}: ${frame.physicalPlacement}; vertices ${formatVertices(frame.vertices)}.`);
  const path = frames.map((frame) => `P${frame.readingOrder}`).join(' -> ');
  const annotationRule = 'Do not print P labels, panel numbers, arrows, coordinates, or guide annotations in the final artwork. Render only the authored dialogue/SFX and scene content.';
  return {
    version: PAGE_LAYOUT_CONTROL_VERSION,
    source,
    templateId,
    frames,
    detailedInstruction: [description, JAPANESE_MANGA_READING_ORDER_LOCK, COORDINATE_SYSTEM,
      formatFrameMap(frames), ...positions, `Story sequence: ${path}. The numbered map defines the path through tall or spanning panels; never replace it with a generic row-by-row sequence.`,
      `Do not add, merge, omit, mirror, or reorder panels. Keep exactly ${actualPanelCount} panels.`, annotationRule].join('\n'),
    finalSuffix: [
      `FINAL AUTHORITATIVE PAGE LAYOUT (${PAGE_LAYOUT_CONTROL_VERSION}${templateId === null ? '' : `; ${templateId}`})`,
      COORDINATE_SYSTEM,
      ...positions,
      `Place each Panel n scene, its characters, and its exact dialogue ONLY inside guide frame Pn. Story sequence: ${path}.`,
      'The last input image is the layout guide; earlier images remain character references. P labels identify frames where space allows; for very narrow custom frames, the coordinate map above supplies the assignment. Use the guide only for geometry and panel assignment, never as scene content or art style.',
      'This numbered placement overrides conflicting layout suggestions in the internal plan. Preserve the authored in-panel subject positions, identities, camera directions, and dialogue locks. Never mirror the page or swap scenes between frames.',
      annotationRule,
    ].join('\n'),
  };
}

export function assemblePageRenderPrompt(
  prompt: string,
  internalPlan: string | null,
  control: PageGenerationLayoutControl | null,
  panelCount: number,
): string {
  const finalInstruction = control?.finalSuffix ?? [
    `FINAL AUTHORITATIVE PAGE READING ORDER (${PAGE_LAYOUT_CONTROL_VERSION})`,
    JAPANESE_MANGA_READING_ORDER_LOCK,
    'Without a complete frame map, read right-to-left within each regular tier, then top-to-bottom. This overrides conflicting layout suggestions in the internal plan.',
    `Keep exactly ${panelCount} panels, in the authored Panel 1 through Panel ${panelCount} sequence. Do not merge, omit, mirror, or reorder panels. Preserve each panel\'s authored content and dialogue.`,
  ].join('\n');
  return [prompt, internalPlan === null ? null : `Internal generation plan:\n${internalPlan}`, finalInstruction]
    .filter((part): part is string => part !== null).join('\n\n');
}

function normalizeFrames(value: unknown, count: number): PageLayoutControlFrame[] | null {
  if (!Array.isArray(value) || value.length !== count || count < 1 || count > MAX_LAYOUT_FRAMES) return null;
  const frames: PageLayoutControlFrame[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const order = entry.reading_order ?? entry.readingOrder;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 1 || order > count) return null;
    if (!Array.isArray(entry.vertices) || entry.vertices.length !== 4) return null;
    const vertices: PanelFrameVertex[] = [];
    for (const vertex of entry.vertices) {
      if (!isRecord(vertex) || !isCoordinate(vertex.x) || !isCoordinate(vertex.y)) return null;
      vertices.push({ x: vertex.x, y: vertex.y });
    }
    const bounds = getBounds(vertices);
    if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return null;
    const style = entry.border_style ?? entry.borderStyle ?? 'solid';
    const width = entry.border_width ?? entry.borderWidth ?? 3;
    const color = entry.border_color ?? entry.borderColor ?? '#000000';
    if (style !== 'solid' && style !== 'dashed' && style !== 'none') return null;
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > 20) return null;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color)) return null;
    frames.push({ readingOrder: order, vertices, borderStyle: style, borderWidth: width, borderColor: color, physicalPlacement: describePhysicalPlacement(vertices) });
  }
  frames.sort((a, b) => a.readingOrder - b.readingOrder);
  return frames.every((frame, index) => frame.readingOrder === index + 1) ? frames : null;
}

function describePhysicalPlacement(vertices: PanelFrameVertex[]): string {
  const { minX, maxX, minY, maxY } = getBounds(vertices);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const horizontal = centerX < 0.45 ? 'left' : centerX > 0.55 ? 'right' : 'center';
  const vertical = centerY <= 1 / 3 ? 'upper' : centerY >= 2 / 3 ? 'lower' : 'middle';
  const fullWidth = minX === 0 && maxX === 1;
  const fullHeight = minY === 0 && maxY === 1;
  const location = fullWidth && fullHeight ? 'full page'
    : fullWidth ? `full-width ${vertical === 'upper' ? 'top' : vertical === 'lower' ? 'bottom' : 'middle'} band`
      : fullHeight ? `full-height ${horizontal} column` : `${vertical}-${horizontal}`;
  return `${location} (x=${minX}..${maxX}, y=${minY}..${maxY})`;
}

function getBounds(vertices: PanelFrameVertex[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return { minX: Math.min(...vertices.map((v) => v.x)), maxX: Math.max(...vertices.map((v) => v.x)), minY: Math.min(...vertices.map((v) => v.y)), maxY: Math.max(...vertices.map((v) => v.y)) };
}

function formatVertices(vertices: PanelFrameVertex[]): string {
  return `[${vertices.map((v) => `(${v.x},${v.y})`).join(',')}]`;
}

function formatFrameMap(frames: PageLayoutControlFrame[]): string {
  return `Authoritative frame map (follow P numbers and coordinates exactly for asymmetric or custom layouts): ${frames.map((frame) => `P${frame.readingOrder}=[${frame.vertices.map((v) => `(${v.x.toFixed(2)},${v.y.toFixed(2)})`).join(',')}]`).join('; ')}.`;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
