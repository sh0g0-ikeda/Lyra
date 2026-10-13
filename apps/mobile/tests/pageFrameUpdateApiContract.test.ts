import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PanelFrameRecord } from '@/domain/types';
import { LyraMobileApiClient } from '@/lib/api';

const pageId = '00000000-0000-4000-8000-000000000001';
const panelId = '00000000-0000-4000-8000-000000000002';
const frameId = '00000000-0000-4000-8000-000000000003';

const frame: PanelFrameRecord = {
  id: frameId,
  page_id: pageId,
  panel_id: panelId,
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  border_style: 'solid',
  border_width: 1,
  border_color: '#000000',
  z_index: 1,
  reading_order: 1,
};

describe('ページ枠更新API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GET由来の枠を更新してもpage_idを更新wireへ送らない', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ frames: [frame] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetch);
    const api = new LyraMobileApiClient(() => 'token');

    await expect(api.replaceFrames(pageId, { frames: [frame] })).resolves.toEqual({ frames: [frame] });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/pages/${pageId}/frames`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PUT');
    const sentBody: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(sentBody).toEqual({
      frames: [
        {
          id: frameId,
          panel_id: panelId,
          vertices: frame.vertices,
          border_style: 'solid',
          border_width: 1,
          border_color: '#000000',
          z_index: 1,
          reading_order: 1,
        },
      ],
    });
  });
});
