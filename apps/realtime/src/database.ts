import { DOC_SCHEMA_VERSION } from '@nova/shared';
import pg from 'pg';

const { Pool } = pg;

/** Postgres persistence adapter for Yjs binary snapshots stored in `"ProjectDocument"`. */
export class PostgresDocumentStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  /** Returns true when the project exists and has not been soft-deleted. */
  async projectExists(projectId: string): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT "id" FROM "Project" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
      [projectId],
    );
    return result.rows.length > 0;
  }

  /** Fetches the encoded Y.Doc state for an active (non-deleted) project, or `null` if uninitialized. */
  async fetchDocument(projectId: string): Promise<Uint8Array | null> {
    const result = await this.pool.query<{ state: Buffer }>(
      `SELECT pd."state"
       FROM "ProjectDocument" pd
       INNER JOIN "Project" p ON p."id" = pd."projectId"
       WHERE pd."projectId" = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [projectId],
    );
    const row = result.rows[0];
    return row ? new Uint8Array(row.state) : null;
  }

  /** Persists the encoded Y.Doc state for an active project via atomic upsert. */
  async storeDocument(projectId: string, state: Uint8Array): Promise<void> {
    await this.pool.query(
      `INSERT INTO "ProjectDocument" ("projectId", "state", "schemaVersion", "updatedAt")
       SELECT p."id", $2, $3, NOW()
       FROM "Project" p
       WHERE p."id" = $1 AND p."deletedAt" IS NULL
       ON CONFLICT ("projectId") DO UPDATE
         SET "state" = EXCLUDED."state",
             "schemaVersion" = EXCLUDED."schemaVersion",
             "updatedAt" = NOW()`,
      [projectId, Buffer.from(state), DOC_SCHEMA_VERSION],
    );
  }

  /** Returns the subset of `projectIds` that belong to `workspaceId` and are not deleted. */
  async filterProjectIdsInWorkspace(
    projectIds: string[],
    workspaceId: string,
  ): Promise<Set<string>> {
    if (projectIds.length === 0) {
      return new Set<string>();
    }
    const result = await this.pool.query<{ id: string }>(
      `SELECT "id" FROM "Project" WHERE "id" = ANY($1::text[]) AND "workspaceId" = $2 AND "deletedAt" IS NULL`,
      [projectIds, workspaceId],
    );
    return new Set(result.rows.map((r) => r.id));
  }

  /** Verifies database connectivity (`SELECT 1`). */
  async ping(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  /** Closes the underlying PostgreSQL connection pool. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
