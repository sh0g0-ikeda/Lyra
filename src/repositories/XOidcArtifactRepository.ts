import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';
import type { XArtifact, XArtifactKind, XArtifactRepository } from '../domain/auth/XOidcProtocol.js';

interface ArtifactRow extends QueryResultRow {
  kind: XArtifactKind; token_hash: string; binding_hash: string;
  payload_ciphertext: string; expires_at: Date; proof_hash: string | null;
}
export class PostgresXOidcArtifactRepository implements XArtifactRepository {
  public constructor(private readonly database: DatabaseClient) {}
  public async save(row: XArtifact): Promise<void> {
    await this.database.query(`INSERT INTO x_oidc_artifacts
      (kind, token_hash, binding_hash, payload_ciphertext, expires_at, proof_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [row.kind, row.hash, row.bindingHash, row.ciphertext, row.expiresAt, row.proofHash ?? null]);
  }
  public async find(kind: XArtifactKind, hash: string, binding: string): Promise<XArtifact | null> {
    const result = await this.database.query<ArtifactRow>(`SELECT * FROM x_oidc_artifacts
      WHERE kind=$1 AND token_hash=$2 AND binding_hash=$3 AND expires_at > NOW() AND attempts < 5`, [kind, hash, binding]);
    return map(result.rows[0]);
  }
  public async consume(kind: XArtifactKind, hash: string, binding: string, proof?: string): Promise<XArtifact | null> {
    // DELETE is the linearization point across API replicas; a callback or grant
    // cannot be redeemed twice, including simultaneous valid requests.
    const result = await this.database.query<ArtifactRow>(`DELETE FROM x_oidc_artifacts
      WHERE kind=$1 AND token_hash=$2 AND binding_hash=$3 AND expires_at > NOW() AND attempts < 5
      AND (proof_hash IS NULL OR proof_hash=$4) RETURNING *`, [kind, hash, binding, proof ?? null]);
    if (result.rows[0]) return map(result.rows[0]);
    if (kind === 'email') {
      await this.database.query(`UPDATE x_oidc_artifacts SET attempts = attempts + 1
        WHERE kind=$1 AND token_hash=$2 AND binding_hash=$3 AND expires_at > NOW() AND attempts < 5`, [kind, hash, binding]);
    }
    return null;
  }
  public async prune(): Promise<void> {
    await this.database.query(`DELETE FROM x_oidc_artifacts WHERE token_hash IN
      (SELECT token_hash FROM x_oidc_artifacts WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 100)`);
  }
  public async reserveEmailDelivery(emailHash: string): Promise<boolean> {
    const result = await this.database.query(`INSERT INTO x_oidc_artifacts
      (kind, token_hash, binding_hash, payload_ciphertext, expires_at)
      VALUES ('delivery',$1,'','-',NOW() + INTERVAL '60 seconds')
      ON CONFLICT (token_hash) DO UPDATE SET expires_at=NOW() + INTERVAL '60 seconds'
      WHERE x_oidc_artifacts.kind='delivery' AND x_oidc_artifacts.expires_at <= NOW()
      RETURNING token_hash`, [emailHash]);
    return result.rows.length === 1;
  }
}
function map(row: ArtifactRow | undefined): XArtifact | null {
  return row === undefined ? null : { kind: row.kind, hash: row.token_hash, bindingHash: row.binding_hash, ciphertext: row.payload_ciphertext, expiresAt: row.expires_at, ...(row.proof_hash ? { proofHash: row.proof_hash } : {}) };
}
