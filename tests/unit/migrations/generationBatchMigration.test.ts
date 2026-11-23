import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generation batch migration 055',()=>{
  it('feature flagとは独立したdurable parent/itemと削除cascadeを追加する',async()=>{
    const sql=await readFile(join(process.cwd(),'migrations','055_add_generation_batches.sql'),'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS generation_batches');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS generation_batch_items');
    expect(sql).toContain('work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE');
    expect(sql).toContain('batch_id UUID NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE');
    expect(sql).toContain("status IN ('quoted','running','paused','needs_review','completed','cancelled')");
    expect(sql).toContain('UNIQUE (batch_id, kind, target_id)');
  });

  it('既存表を長時間lockせず部分適用を再実行できるindexを作る',async()=>{
    const sql=await readFile(join(process.cwd(),'migrations','055_add_generation_batches.sql'),'utf8');
    expect(sql.startsWith('-- lyra:migration no-transaction')).toBe(true);
    expect(sql.match(/CREATE (?:UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS/gu)).toHaveLength(5);
  });

  it('一括額前払い列を持たずchild quote/job linkを保存する',async()=>{
    const sql=await readFile(join(process.cwd(),'migrations','055_add_generation_batches.sql'),'utf8');
    expect(sql).toContain('child_quote_id UUID REFERENCES generation_quotes(id) ON DELETE SET NULL');
    expect(sql).toContain('job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL');
    expect(sql).not.toContain('charged_credits');
    expect(sql).not.toContain('credit_ledger');
  });
});
