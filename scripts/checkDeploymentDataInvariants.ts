import { pathToFileURL } from 'node:url';
import { sanitizePersistedErrorMessage } from '../src/lib/errorSanitizer.js';
import type { DatabaseClient } from '../src/lib/db.js';

interface InvariantQuery {
  name: string;
  sql: string;
}

interface InvariantRow {
  id: unknown;
}

export interface DeploymentDataInvariantViolation {
  name: string;
  sampleIds: string[];
}

export interface DeploymentDataInvariantReport {
  ok: boolean;
  checkedCount: number;
  violations: DeploymentDataInvariantViolation[];
}

const SAMPLE_LIMIT = 10;

const DEPLOYMENT_DATA_INVARIANT_QUERIES: InvariantQuery[] = [
  {
    name: 'works.status',
    sql: "SELECT id::text AS id FROM works WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'chapters.status',
    sql: "SELECT id::text AS id FROM chapters WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'episodes.status',
    sql: "SELECT id::text AS id FROM episodes WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'scenes.status',
    sql: "SELECT id::text AS id FROM scenes WHERE status NOT IN ('draft', 'reviewing', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'entities.status',
    sql: "SELECT id::text AS id FROM entities WHERE status NOT IN ('draft', 'ready') ORDER BY id LIMIT $1",
  },
  {
    name: 'reference_sets.status',
    sql: "SELECT entity_id::text AS id FROM reference_sets WHERE status NOT IN ('empty', 'partial', 'ready') ORDER BY entity_id LIMIT $1",
  },
  {
    name: 'pages.status',
    sql: "SELECT id::text AS id FROM pages WHERE status NOT IN ('designing', 'generating', 'generated', 'editing', 'confirmed') ORDER BY id LIMIT $1",
  },
  {
    name: 'pages.dialogue_mode',
    sql: "SELECT id::text AS id FROM pages WHERE dialogue_mode NOT IN ('image_baked', 'balloon_only', 'mixed') ORDER BY id LIMIT $1",
  },
  {
    name: 'pages.generation_mode',
    sql: "SELECT id::text AS id FROM pages WHERE generation_mode IS NOT NULL AND generation_mode NOT IN ('standard', 'thinking') ORDER BY id LIMIT $1",
  },
  {
    name: 'panels.panel_role',
    sql: "SELECT id::text AS id FROM panels WHERE panel_role IS NOT NULL AND panel_role NOT IN ('establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact') ORDER BY id LIMIT $1",
  },
  {
    name: 'panels.panel_size',
    sql: "SELECT id::text AS id FROM panels WHERE panel_size IS NOT NULL AND panel_size NOT IN ('standard', 'large', 'wide', 'narrow', 'splash') ORDER BY id LIMIT $1",
  },
  {
    name: 'panel_frames.border_style',
    sql: "SELECT id::text AS id FROM panel_frames WHERE border_style IS NOT NULL AND border_style NOT IN ('solid', 'dashed', 'none') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.balloon_type',
    sql: "SELECT id::text AS id FROM balloons WHERE balloon_type NOT IN ('speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.writing_mode',
    sql: "SELECT id::text AS id FROM balloons WHERE writing_mode IS NOT NULL AND writing_mode NOT IN ('vertical', 'horizontal') ORDER BY id LIMIT $1",
  },
  {
    name: 'balloons.font_family',
    sql: "SELECT id::text AS id FROM balloons WHERE font_family IS NOT NULL AND font_family NOT IN ('manga_gothic', 'mincho', 'rounded', 'bold') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.job_type',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE job_type NOT IN ('page_generate', 'entity_generate') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.status',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE status NOT IN ('queued', 'processing', 'completed', 'failed') ORDER BY id LIMIT $1",
  },
  {
    name: 'generation_jobs.generation_mode',
    sql: "SELECT id::text AS id FROM generation_jobs WHERE generation_mode IS NOT NULL AND generation_mode NOT IN ('standard', 'thinking') ORDER BY id LIMIT $1",
  },
  {
    name: 'users.plan_code',
    sql: "SELECT id::text AS id FROM users WHERE plan_code NOT IN ('free', 'standard', 'premium') ORDER BY id LIMIT $1",
  },
  {
    name: 'subscriptions.plan_code',
    sql: "SELECT id::text AS id FROM subscriptions WHERE plan_code NOT IN ('free', 'standard', 'premium') ORDER BY id LIMIT $1",
  },
  {
    name: 'subscriptions.status',
    sql: "SELECT id::text AS id FROM subscriptions WHERE status NOT IN ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid') ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.type',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE type NOT IN ('signup_bonus', 'monthly_grant', 'purchase', 'consume', 'refund') ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.amount_sign',
    sql: "SELECT id::text AS id FROM credit_ledger WHERE NOT ((type = 'consume' AND amount < 0) OR (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund') AND amount > 0)) ORDER BY id LIMIT $1",
  },
  {
    name: 'credit_ledger.bucket_delta_pair',
    sql: 'SELECT id::text AS id FROM credit_ledger WHERE (monthly_delta IS NULL) <> (purchased_delta IS NULL) ORDER BY id LIMIT $1',
  },
  {
    name: 'payment_records.kind',
    sql: "SELECT id::text AS id FROM payment_records WHERE kind NOT IN ('subscription', 'credit_purchase') ORDER BY id LIMIT $1",
  },
  {
    name: 'payment_records.status',
    sql: "SELECT id::text AS id FROM payment_records WHERE status NOT IN ('paid', 'failed') ORDER BY id LIMIT $1",
  },
  {
    name: 'payment_records.amount_jpy',
    sql: 'SELECT id::text AS id FROM payment_records WHERE amount_jpy < 0 ORDER BY id LIMIT $1',
  },
];

export async function checkDeploymentDataInvariants(
  database: DatabaseClient,
): Promise<DeploymentDataInvariantReport> {
  const violations: DeploymentDataInvariantViolation[] = [];

  for (const query of DEPLOYMENT_DATA_INVARIANT_QUERIES) {
    const result = await database.query<InvariantRow>(query.sql, [SAMPLE_LIMIT]);
    if (result.rows.length === 0) {
      continue;
    }

    violations.push({
      name: query.name,
      sampleIds: result.rows.map((row) => String(row.id)),
    });
  }

  return {
    ok: violations.length === 0,
    checkedCount: DEPLOYMENT_DATA_INVARIANT_QUERIES.length,
    violations,
  };
}

async function main(): Promise<void> {
  const { closeDatabasePool, db } = await import('../src/lib/db.js');

  try {
    const report = await checkDeploymentDataInvariants(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabasePool();
  }
}

function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(sanitizePersistedErrorMessage(error, 'Unknown deployment invariant check error'));
    process.exitCode = 1;
  });
}
