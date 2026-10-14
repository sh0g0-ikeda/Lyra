import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { usePagePanelSelection } from '@/hooks/usePagePanelSelection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = Parameters<typeof usePagePanelSelection>[0];
const panel = (id: string, pageId: string, order: number) => ({ id, page_id: pageId, order });
function Harness(props: Props): null { usePagePanelSelection(props); return null; }
const defaults = (onSelect: Props['onSelect']): Props => ({ page: { id: 'page-1' }, selectionScope: 'session-1/personal/episode-1', panels: [panel('panel-2','page-1',2),panel('panel-1','page-1',1)], panelsLoaded: true, onSelect });

describe('usePagePanelSelection', () => {
  it('ページの初回読込で保存順の最初のコマを選ぶ', () => {
    const onSelect=vi.fn(); act(()=>{create(<Harness {...defaults(onSelect)} />);});
    expect(onSelect).toHaveBeenLastCalledWith('panel-1');
  });
  it('別ページへ切り替えるたびにそのページの先頭コマを選ぶ', () => {
    const onSelect=vi.fn(); let r: ReturnType<typeof create>;
    act(()=>{r=create(<Harness {...defaults(onSelect)} />);}); onSelect.mockClear();
    act(()=>{r!.update(<Harness {...defaults(onSelect)} page={{id:'page-2'}} panels={[panel('page2-panel2','page-2',2),panel('page2-panel1','page-2',1)]} />);});
    expect(onSelect).toHaveBeenLastCalledWith('page2-panel1');
  });
  it('同じページの再読込で後から選んだコマをリセットしない', () => {
    const onSelect=vi.fn(); let r: ReturnType<typeof create>;
    act(()=>{r=create(<Harness {...defaults(onSelect)} />);}); onSelect.mockClear();
    act(()=>{r!.update(<Harness {...defaults(onSelect)} panels={[panel('panel-1','page-1',1),panel('panel-2','page-1',2)]} />);});
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('読み込み中の旧ページのコマを選ばず現在ページの取得成功を待つ', () => {
    const onSelect=vi.fn(); let r: ReturnType<typeof create>;
    act(()=>{r=create(<Harness {...defaults(onSelect)} />);}); onSelect.mockClear();
    act(()=>{r!.update(<Harness {...defaults(onSelect)} page={{id:'page-2'}} panelsLoaded={false} />);});
    expect(onSelect).toHaveBeenLastCalledWith(null);
    act(()=>{r!.update(<Harness {...defaults(onSelect)} page={{id:'page-2'}} panelsLoaded panels={[panel('late-old','page-1',1)]} />);});
    expect(onSelect).not.toHaveBeenCalledWith('late-old');
    act(()=>{r!.update(<Harness {...defaults(onSelect)} page={{id:'page-2'}} panels={[panel('current','page-2',1)]} />);});
    expect(onSelect).toHaveBeenLastCalledWith('current');
  });
  it('空のページに架空のコマを作らない', () => {
    const onSelect=vi.fn(); act(()=>{create(<Harness {...defaults(onSelect)} panels={[]} />);});
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it('同じページIDでも利用者や話のscopeが変われば先頭を選び直す', () => {
    const onSelect=vi.fn(); let r: ReturnType<typeof create>;
    act(()=>{r=create(<Harness {...defaults(onSelect)} />);}); onSelect.mockClear();
    act(()=>{r!.update(<Harness {...defaults(onSelect)} selectionScope="session-2/org-2/episode-2" />);});
    expect(onSelect).toHaveBeenLastCalledWith('panel-1');
  });
  it('話の再自動入力でページ選択が解除された後は先頭を選び直す', () => {
    const onSelect=vi.fn(); let r: ReturnType<typeof create>;
    act(()=>{r=create(<Harness {...defaults(onSelect)} />);});
    act(()=>{r!.update(<Harness {...defaults(onSelect)} page={null} panelsLoaded={false} panels={[]} />);}); onSelect.mockClear();
    act(()=>{r!.update(<Harness {...defaults(onSelect)} />);});
    expect(onSelect).toHaveBeenLastCalledWith('panel-1');
  });
});


it('空キャッシュを再取得している間は初期選択を完了せず新しい先頭コマを選ぶ', () => {
 const onSelect=vi.fn();let r:ReturnType<typeof create>;
 act(()=>{r=create(<Harness {...defaults(onSelect)} panels={[]} panelsFetching />);});
 onSelect.mockClear();
 act(()=>{r!.update(<Harness {...defaults(onSelect)} panels={[panel('loaded-first','page-1',1)]} panelsFetching={false} />);});
 expect(onSelect).toHaveBeenLastCalledWith('loaded-first');
});
