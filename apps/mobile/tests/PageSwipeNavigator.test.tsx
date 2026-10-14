import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PageSwipeNavigator } from '@/components/PageSwipeNavigator';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('react-native',()=>({View:'view',Text:'text',Pressable:'button',StyleSheet:{create:<T,>(s:T):T=>s},PanResponder:{create:(c:Record<string,((e:unknown,g:unknown)=>unknown)|undefined>)=>({panHandlers:{onMoveShouldSetResponder:c.onMoveShouldSetPanResponder,onResponderGrant:c.onPanResponderGrant,onResponderMove:c.onPanResponderMove,onResponderRelease:c.onPanResponderRelease,onResponderTerminate:c.onPanResponderTerminate}})}}));
const gesture=(dx:number,dy=0,numberActiveTouches=1)=>({dx,dy,numberActiveTouches});
function setup(canPrevious=true,canNext=true,loading=false){const onMove=vi.fn();let r:ReturnType<typeof create>;act(()=>{r=create(<PageSwipeNavigator canPrevious={canPrevious} canNext={canNext} currentPageNumber={2} language="ja" loading={loading} onMove={onMove}/>);});return {onMove,zone:r!.root.findByProps({testID:'page-swipe-navigation'}),r:r!};}
describe('PageSwipeNavigator',()=>{
  it('左スワイプで次のページへ一回移動する',()=>{const {onMove,zone}=setup();act(()=>{zone.props.onResponderGrant?.({},gesture(0));zone.props.onResponderRelease?.({},gesture(-90));});expect(onMove).toHaveBeenCalledExactlyOnceWith(1);});
  it('右スワイプで前のページへ一回移動する',()=>{const {onMove,zone}=setup();act(()=>{zone.props.onResponderGrant?.({},gesture(0));zone.props.onResponderRelease?.({},gesture(90));});expect(onMove).toHaveBeenCalledExactlyOnceWith(-1);});
  it('縦スクロールと短いタップをページ移動として扱わない',()=>{const {onMove,zone}=setup();expect(zone.props.onMoveShouldSetResponder?.({},gesture(10,80))??false).toBe(false);act(()=>{zone.props.onResponderRelease?.({},gesture(20,0));zone.props.onResponderRelease?.({},gesture(-60,80));});expect(onMove).not.toHaveBeenCalled();});
  it('一指の横移動だけを受け付ける',()=>{const {zone}=setup();expect(zone.props.onMoveShouldSetResponder?.({},gesture(30,2))??false).toBe(true);expect(zone.props.onMoveShouldSetResponder?.({},gesture(30,2,2))??false).toBe(false);});
  it('両端と読み込み中はスワイプで移動しない',()=>{for(const state of [[false,false,false],[true,true,true]] as const){const {onMove,zone}=setup(...state);act(()=>{zone.props.onResponderRelease?.({},gesture(90));zone.props.onResponderRelease?.({},gesture(-90));});expect(onMove).not.toHaveBeenCalled();}});
  it('ジェスチャー中に二本指へ変わったときは移動しない',()=>{const {onMove,zone}=setup();act(()=>{zone.props.onResponderGrant?.({},gesture(0));zone.props.onResponderMove?.({},gesture(80,0,2));zone.props.onResponderRelease?.({},gesture(90,0,0));});expect(onMove).not.toHaveBeenCalled();});
  it('前後ボタンにも同じ読み込み境界を適用する',()=>{const {onMove,r}=setup(false,true);const previous=r.root.findByProps({accessibilityLabel:'前のページ'});expect(previous.props.disabled).toBe(true);act(()=>{r.root.findByProps({accessibilityLabel:'次のページ'}).props.onPress();});expect(onMove).toHaveBeenCalledExactlyOnceWith(1);});
});
