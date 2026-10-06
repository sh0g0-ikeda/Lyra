import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
// Spec §11: staging preserves the current production tmp/deletion one-day policy,
// while every v2 ordinary marker is outside current and noncurrent expiration.
// Production config was read only; no production policy is changed by this test.
const template=JSON.parse(readFileSync(new URL('./foundation.json',import.meta.url),'utf8'));
const rules=template.Resources.StagingAssetsBucket.Properties.LifecycleConfiguration?.Rules??[];
const expirationRules=rules.filter(r=>r.ExpirationInDays!==undefined||r.NoncurrentVersionExpiration!==undefined||r.ExpiredObjectDeleteMarker!==undefined);
function applies(rule,key,tags={}){return rule.Status==='Enabled'&&key.startsWith(rule.Prefix??'')&&(rule.TagFilters??[]).every(t=>tags[t.Key]===t.Value);}
test('一時uploadの場合に現行本番と同じ1日で現行版と過去版を整理する',()=>{const matching=expirationRules.filter(r=>applies(r,'tmp/controlled-user/entities/imports/controlled.png'));assert.equal(matching.length,1);assert.equal(matching[0].ExpirationInDays,1);assert.equal(matching[0].NoncurrentVersionExpiration.NoncurrentDays,1);});
test('退会で予約した保存画像の場合にpendingタグの画像だけを1日で整理する',()=>{const key='saved/controlled-user/entities/controlled.png';const matching=expirationRules.filter(r=>applies(r,key,{'lyra-deletion-state':'pending'}));assert.equal(matching.length,1);assert.equal(matching[0].ExpirationInDays,1);assert.equal(matching[0].NoncurrentVersionExpiration.NoncurrentDays,1);assert.equal(expirationRules.filter(r=>applies(r,key)).length,0);});
test('v2状態画像markerの場合にタグ有無に関わらず現行版と過去版を期限削除しない',()=>{for(const tags of [{},{'lyra-deletion-state':'pending'}])for(const key of ['state-reference-v2/controlled/marker','state-reference-v2/controlled/attempt.png','session/controlled/normal.png'])assert.equal(expirationRules.filter(r=>applies(r,key,tags)).length,0);assert.equal(expirationRules.some(r=>r.ExpiredObjectDeleteMarker===true),false);});
test('未完multipartだけを1日で中断し完成した画像の削除規則を増やさない',()=>{const matching=rules.filter(r=>r.AbortIncompleteMultipartUpload!==undefined);assert.equal(matching.length,1);assert.equal(matching[0].AbortIncompleteMultipartUpload.DaysAfterInitiation,1);assert.equal(matching[0].ExpirationInDays,undefined);assert.equal(matching[0].NoncurrentVersionExpiration,undefined);assert.equal(rules.length,3);});
