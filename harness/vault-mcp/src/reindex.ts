// `npm run reindex`: rebuilds the semantic index from scratch. The server keeps it current on its own;
// run this after changing the model or chunking, or if the index looks wrong.
import { createSemanticIndex, createVault, indexDir, vaultRoot } from './config.ts';

const index = createSemanticIndex();
const vault = createVault(index);
await vault.assertReady();
const started = Date.now();
const result = await index.rebuild(await vault.listNotes());
console.log(`reindexed ${vaultRoot} into ${indexDir}: ${result.embedded} notes in ${Date.now() - started} ms`);
