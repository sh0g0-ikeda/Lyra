import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('026 mobile store purchase ledger migration', () => {
  it('keeps personal store purchases and every idempotency barrier in database constraints', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '029_add_mobile_store_purchase_ledger.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mobile_store_purchases');
    expect(sql).toContain('user_id uuid NOT NULL REFERENCES users(id)');
    expect(sql).not.toContain('organization_id');
    expect(sql).toContain('UNIQUE (store, external_purchase_key)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mobile_store_purchase_events');
    expect(sql).toContain('UNIQUE (store, event_key)');
    expect(sql).toContain('UNIQUE (store, transaction_key, operation)');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS mobile_store_event_key text');
    expect(sql).toContain('idx_credit_ledger_mobile_store_event_unique');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS credit_ledger_type_check');
    expect(sql).toContain("'purchase_reversal'");
  });
});
