import {describe,expect,it} from 'vitest';
import {normalizeGenerationJobRecord,type GenerationJobWireRecord} from '../../../apps/web/src/domain/jobCompatibility.js';
describe('Web job status wire compatibility',()=>{
 it.each(['canceled','cancelled'] as const)('取消%sを既存Web statusへ正規化し由来metadataは保持する',status=>{
  const wire={status,id:'job',result:{image_model:'hy4-preview',mobile_access:'web_only'}} as unknown as GenerationJobWireRecord;
  const normalized=normalizeGenerationJobRecord(wire);expect(normalized.status).toBe('cancelled');expect(normalized.result).toEqual(wire.result);expect(wire.status).toBe(status);
 });
});
