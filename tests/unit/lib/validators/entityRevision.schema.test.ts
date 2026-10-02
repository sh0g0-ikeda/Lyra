import { describe, expect, it } from 'vitest';
import { updateEntityBodySchema } from '../../../../src/lib/validators/entity.schema.js';
describe('entity revision compatibility',()=>{
  it('shipped timestamp付きpartial updateと省略clientを受け入れる',()=>{
    expect(updateEntityBodySchema.safeParse({name:'name',expected_updated_at:'2026-10-01T12:00:00.123Z'}).success).toBe(true);
    expect(updateEntityBodySchema.safeParse({name:'name'}).success).toBe(true);
  });
  it('timestampのみと不正値を拒否する',()=>{
    expect(updateEntityBodySchema.safeParse({expected_updated_at:'2026-10-01T12:00:00.123Z'}).success).toBe(false);
    expect(updateEntityBodySchema.safeParse({name:'name',expected_updated_at:'bad'}).success).toBe(false);
    expect(updateEntityBodySchema.safeParse({name:'name',expected_updated_at:null}).success).toBe(false);
  });
});
