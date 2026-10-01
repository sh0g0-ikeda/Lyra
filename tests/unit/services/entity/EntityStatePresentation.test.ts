import { describe, expect, it } from 'vitest';
import type { EntityState } from '../../../../src/domain/types/scene.js';
import { computeStateReferenceFingerprint } from '../../../../src/domain/state/StateReferenceFingerprint.js';
import { presentEntityStateReference } from '../../../../src/services/entity/EntityStatePresentation.js';

const entityId = '20000000-0000-4000-8000-000000000001';
const stateId = '30000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000001';
const state: EntityState = {
 id: stateId, entityId, sceneId:null, name:'injured', description:'cheek scar', referenceImage:null,
 costumeNote:null,costumeRefId:null,conditionNote:null,hairNote:null,expressionDefault:'neutral',extraNote:null,
 createdAt:new Date('2026-10-01T00:00:00Z'),updatedAt:new Date('2026-10-01T00:00:00Z'),
};
const descriptor = {
 ref_id:'ref-state',s3_key:`saved/${ownerId}/entities/${entityId}/states/${stateId}/ref-state.png`,
 storage_owner_user_id:ownerId,image_model:'gpt-image-2',base_ref_id:'base',created_at:'2026-10-01T00:00:00.000Z',
 input_fingerprint:computeStateReferenceFingerprint({entityId,stateId,name:'injured',description:'cheek scar',baseRefId:'base'}),
};
describe('entity state reference presentation', () => {
 it('旧注記と未確定を区別する', () => {
  expect(presentEntityStateReference({...state,name:null,description:null})).toEqual({reference_status:'legacy',reference_image:null});
  expect(presentEntityStateReference(state)).toEqual({reference_status:'draft',reference_image:null});
 });
 it('現在のbaseと内容が一致する画像だけ確定とし内部キーを返さない', () => {
  const result=presentEntityStateReference({...state,baseReferenceId:'base',referenceImage:descriptor});
  expect(result.reference_status).toBe('confirmed');
  expect(result.reference_image).toEqual({mobile_access:'available',ref_id:'ref-state',image_model:'gpt-image-2',base_ref_id:'base',created_at:descriptor.created_at,input_fingerprint:descriptor.input_fingerprint});
  expect(JSON.stringify(result)).not.toContain('saved/');
  expect(JSON.stringify(result)).not.toContain(ownerId);
 });
 it('base変更・本文変更・不正キーを未反映として示す', () => {
  for(const changed of [
   {...state,baseReferenceId:'new-base',referenceImage:descriptor},
   {...state,baseReferenceId:'base',description:'changed',referenceImage:descriptor},
   {...state,baseReferenceId:'base',referenceImage:{...descriptor,s3_key:'saved/foreign/private.png'}},
  ]) expect(presentEntityStateReference(changed).reference_status).toBe('stale');
 });
});
