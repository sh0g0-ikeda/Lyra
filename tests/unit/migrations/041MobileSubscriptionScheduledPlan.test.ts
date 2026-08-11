import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('041 mobile subscription scheduled plan migration', () => {
  it('現在権利と次回更新プランを分離しサブスク以外の予約をDB制約で拒否する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '041_add_mobile_subscription_scheduled_plan.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain('add column if not exists scheduled_product_id text');
    expect(normalized).toContain('add column if not exists scheduled_plan_code text');
    expect(normalized).toContain('add column if not exists scheduled_effective_at timestamptz');
    expect(normalized).toContain("kind = 'subscription'");
    expect(normalized).toContain("scheduled_plan_code in ('standard', 'premium')");
    expect(normalized).toContain('scheduled_product_id is null');
    expect(normalized).toContain('scheduled_plan_code is null');
    expect(normalized).toContain('scheduled_effective_at is null');
  });
});
