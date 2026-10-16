// Schema migrations, applied in order; PRAGMA user_version stores how many have run.
// Append only: never edit a migration that has been committed (guardrail W3 asks before changes here).
export const MIGRATIONS: readonly string[] = [];
