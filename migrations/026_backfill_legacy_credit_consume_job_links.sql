-- Repair only the legacy consume/job pairs that were verified against the
-- development ledger before this migration was authored. Do not infer links
-- from timestamps: same-cost generation requests can occur close together.
-- Amounts, bucket deltas, balances, and refund rows are intentionally unchanged.
WITH verified_pairs (ledger_id, job_id) AS (
  VALUES
    ('7a5ac356-bcdc-4437-ae12-90719721edb9'::uuid, 'e05c62bc-0200-4f9c-93bc-adf3a8a781f2'::uuid),
    ('97acbae3-6b00-4aaa-8c56-63cdc179b1fd'::uuid, '09bdaeb9-41fd-4240-b790-1460df745b58'::uuid),
    ('7127ef27-c145-4846-81df-3ca619ace9fa'::uuid, '822cd296-1bb8-4caa-9ead-a21c81399b14'::uuid),
    ('534e48e2-634d-4808-ae05-7989b19ded27'::uuid, '56dda3f4-b928-49bc-a61b-31381abde815'::uuid),
    ('67747807-c937-49b9-a90d-d87f973c5da9'::uuid, '50326e03-486b-4fbb-88b9-df676424c720'::uuid),
    ('2e3071a5-1048-4d50-8d47-15557d540d81'::uuid, 'ef31cf51-313d-4221-bb52-7d65f2ec38c8'::uuid),
    ('cef0763d-c340-4bee-b149-6fc01c5b7a6f'::uuid, 'dc8d7dd1-ac59-4b0b-9ca8-8b270478b727'::uuid),
    ('b63c6ee0-b95f-4ab7-88ac-2d2992ce43f5'::uuid, '8579b8f9-b66f-4fd0-b1a0-ad81fb45b343'::uuid),
    ('2f025134-6da4-47a1-bfc9-f5f2e4a1d080'::uuid, '97e6d178-f2d8-494f-95d3-cb5a1dad42b6'::uuid),
    ('9bb2b015-028a-4270-91a4-df09a0ecd092'::uuid, '7bbcea02-2b2c-4140-b7a1-9188f02bfe8a'::uuid),
    ('767db372-63c4-4c94-8e34-1e8f2069c33f'::uuid, '67752a9d-7eb0-4b59-8fbb-616350af90c3'::uuid),
    ('483e5c65-9500-478a-bb43-a50500797fe9'::uuid, '2ddbb662-30ae-491c-89dd-58930b6191fe'::uuid)
)
UPDATE credit_ledger AS consume_ledger
SET job_id = verified_pairs.job_id
FROM verified_pairs
JOIN generation_jobs
  ON generation_jobs.id = verified_pairs.job_id
WHERE consume_ledger.id = verified_pairs.ledger_id
  AND consume_ledger.job_id IS NULL
  AND consume_ledger.type = 'consume'
  AND consume_ledger.amount = -generation_jobs.credit_cost
  AND generation_jobs.job_type IN ('page_generate', 'entity_generate')
  AND generation_jobs.status IN ('failed', 'cancelled')
  AND generation_jobs.credit_cost > 0
  AND (
    (
      generation_jobs.organization_id IS NULL
      AND consume_ledger.organization_id IS NULL
      AND consume_ledger.user_id = generation_jobs.user_id
    )
    OR (
      generation_jobs.organization_id IS NOT NULL
      AND consume_ledger.organization_id = generation_jobs.organization_id
    )
  )
  AND EXISTS (
    SELECT 1
    FROM credit_ledger AS refund_ledger
    WHERE refund_ledger.job_id = generation_jobs.id
      AND refund_ledger.type = 'refund'
      AND refund_ledger.amount = generation_jobs.credit_cost
      AND (
        (
          generation_jobs.organization_id IS NULL
          AND refund_ledger.organization_id IS NULL
          AND refund_ledger.user_id = generation_jobs.user_id
        )
        OR (
          generation_jobs.organization_id IS NOT NULL
          AND refund_ledger.organization_id = generation_jobs.organization_id
        )
      )
  );
