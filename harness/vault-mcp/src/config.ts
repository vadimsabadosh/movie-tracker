// Vault and search setup shared by the MCP server and the reindex command.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, localEmbedder, SemanticIndex } from './semantic.ts';
import { Vault } from './vault.ts';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// harness/vault-mcp -> app repository root
const APP_ROOT = path.resolve(PACKAGE_ROOT, '../..');
// The vault is a sibling clone of the app repository, never a folder inside it (ADR-005).
export const vaultRoot = path.resolve(APP_ROOT, process.env.VAULT_PATH ?? '../movie-tracker-vault');
// Derived and git-ignored: the vector index and the downloaded embedding model (ADR-012).
export const indexDir = path.resolve(PACKAGE_ROOT, process.env.VAULT_INDEX_DIR ?? '.index');
// `keyword` turns semantic search off, e.g. to compare retrieval before and after PR7.
export const searchMode = process.env.VAULT_SEARCH === 'keyword' ? 'keyword' : 'semantic';

export function createSemanticIndex(): SemanticIndex {
  const model = process.env.VAULT_EMBED_MODEL ?? DEFAULT_MODEL;
  return new SemanticIndex({
    dir: path.join(indexDir, 'lancedb'),
    model,
    embed: localEmbedder({ model, cacheDir: path.join(indexDir, 'models') }),
  });
}

export function createVault(semantic?: SemanticIndex): Vault {
  return new Vault({
    root: vaultRoot,
    mocFile: process.env.VAULT_MOC ?? 'MOC - movie-tracker.md',
    push: process.env.VAULT_PUSH !== 'false',
    semantic,
  });
}
