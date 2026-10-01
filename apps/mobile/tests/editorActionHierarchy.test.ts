import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source=(name:string):string=>readFileSync(`src/${name}.tsx`,'utf8');
const action=(name:string,handler:string):string=>{const text=source(name);const at=text.indexOf(handler);return text.slice(text.lastIndexOf('<PrimaryButton',at),text.indexOf('/>',at));};
describe('制作工程の主要操作と補助操作',()=>{
 it('本文AIの改善と相談は補助操作として両方残す',()=>{
  expect(action('components/EpisodeImprovementPanel','onPress={onImprove}')).toContain('variant="secondary"');
  expect(action('components/StoryCollaborationPanel','onPress={onRequest}')).toContain('variant="secondary"');
 });
 it('漫画のキャラ工程はshellの次へをprimaryにしimportと状態操作はsecondaryにする',()=>{
  expect(source('screens/MangaScreen')).toContain('<CharactersScreen secondaryActions');
  expect(action('components/QuotedEntityImport','onPress={requestUpload}')).toContain('variant="secondary"');
  expect(action('components/EntityStateEditor','onPress={confirmPreview}')).toContain('variant="secondary"');
  expect(action('components/EntityStateEditor','void confirmCandidate();')).toContain('variant="secondary"');
 });
 it('ページの保存はsecondaryで画像生成と既存設定の次へをprimaryとして維持する',()=>{
  const text=source('screens/PagesScreen');const buttons=text.match(/<PrimaryButton\b[\s\S]*?\/>/g)??[];
  for(const button of buttons.filter(button=>button.includes("label={t(language, 'save')}"))) expect(button).toContain('variant="secondary"');
  expect(action('components/PageGenerationActions','onPress={onGenerate}')).not.toContain('variant="secondary"');
 });
});
