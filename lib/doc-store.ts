/**
 * Document Store — Multi-category storage for after-sales knowledge base.
 *
 * Uses context.store.langgraphStore (proper KV store).
 * Only callable from agent endpoints (`agents/<name>/index.ts`); cloud-functions
 * get `context.agent.store` which has `langgraphStore` stripped by the runtime,
 * so this module does not work in that context.
 *
 * Storage layout (single global manifest, mirrors orders.ts pattern):
 *   namespace: ["kb", "doc", category]   key: docId   → DocRecord (full record incl content)
 *   namespace: ["kb", "doc_manifest"]    key: "all"   → { entries: ManifestEntry[] }
 *
 * Categories: faq, policy, product, order_doc
 *
 * Why single manifest instead of per-category? The previous pattern
 * (["kb","manifest"][category]) appeared to fail intermittently on EdgeOne KV,
 * yielding empty manifests after successful writes. Orders use the same
 * single-key pattern reliably, so we mirror that here.
 */
// Revision notes:
// - Removed the module-level _globalStore singleton (would mismatch under
//   concurrency / cold start; conflicts with SOP H-175 "Never treat an
//   in-process `new Map()` as durable storage").
// - Every function now requires `store` as its first argument; callers pass
//   `context.store` explicitly.

import { createLogger } from "../agents/_shared";

const logger = createLogger("doc-store");

// ─── Types ───

export type DocCategory = "faq" | "policy" | "product" | "order_doc";

export interface DocSummary {
  docId: string;
  category: DocCategory;
  filename: string;
  summary: string;
  keywords: string[];
  charCount: number;
  uploadedAt: string;
}

interface DocRecord extends DocSummary {
  content: string;
}

// ─── LangGraph Store helpers ───

function getLanggraphStore(store: any): any {
  return store.langgraphStore;
}

function docNamespace(category: string): string[] {
  return ["kb", "doc", category];
}

const DOC_MANIFEST_NAMESPACE = ["kb", "doc_manifest"];
const MANIFEST_KEY = "all";

async function readManifest(store: any): Promise<DocSummary[]> {
  try {
    const kv = getLanggraphStore(store);
    const item = await kv.get(DOC_MANIFEST_NAMESPACE, MANIFEST_KEY);
    if (item?.value?.entries && Array.isArray(item.value.entries)) {
      return item.value.entries as DocSummary[];
    }
  } catch (e) {
    logger.error("readManifest failed:", (e as Error).message);
  }
  return [];
}

async function writeManifest(store: any, entries: DocSummary[]): Promise<void> {
  const kv = getLanggraphStore(store);
  await kv.put(DOC_MANIFEST_NAMESPACE, MANIFEST_KEY, { entries });
}

async function getDocRecord(store: any, category: string, docId: string): Promise<DocRecord | null> {
  try {
    const kv = getLanggraphStore(store);
    const item = await kv.get(docNamespace(category), docId);
    return (item?.value as DocRecord) ?? null;
  } catch {}
  return null;
}

async function storeDocRecord(store: any, record: DocRecord): Promise<void> {
  const kv = getLanggraphStore(store);
  await kv.put(docNamespace(record.category), record.docId, record as any);
}

// ─── Public API ───

const ALL_CATEGORIES: DocCategory[] = ["faq", "policy", "product", "order_doc"];

/**
 * Get all summaries, optionally filtered by category.
 * Both arguments are required: (store, category?).
 */
export async function getAllSummaries(store: any, category?: string): Promise<DocSummary[]> {
  const entries = await readManifest(store);
  if (!category) return entries;
  if (!ALL_CATEGORIES.includes(category as DocCategory)) return [];
  return entries.filter((e) => e.category === category);
}

/**
 * Get full document content by category and docId.
 */
export async function getDocContent(store: any, category: string, docId: string): Promise<string | null> {
  const rec = await getDocRecord(store, category, docId);
  return rec?.content ?? null;
}

/**
 * Save a document with its content and summary metadata.
 */
export async function saveDoc(
  store: any,
  category: DocCategory,
  docId: string,
  filename: string,
  content: string,
  summary: string,
  keywords: string[] = []
): Promise<void> {

  const uploadedAt = new Date().toISOString();
  const record: DocRecord = {
    docId,
    category,
    filename,
    content,
    summary,
    keywords,
    charCount: content.length,
    uploadedAt,
  };

  // Write full record first
  await storeDocRecord(store, record);

  // Update single global manifest (read-modify-write)
  const entries = await readManifest(store);
  const withoutCurrent = entries.filter((e) => e.docId !== docId);
  const summaryEntry: DocSummary = {
    docId,
    category,
    filename,
    summary,
    keywords,
    charCount: content.length,
    uploadedAt,
  };
  await writeManifest(store, [summaryEntry, ...withoutCurrent]);

  logger.log(`Saved doc: ${filename} (${category}/${docId}), ${content.length} chars, manifest now has ${withoutCurrent.length + 1} entries`);
}

/**
 * Remove a document by category and docId.
 */
export async function removeDoc(store: any, category: string, docId: string): Promise<boolean> {
  try {
    const kv = getLanggraphStore(store);
    await kv.delete(docNamespace(category), docId);
    const entries = await readManifest(store);
    await writeManifest(store, entries.filter((e) => e.docId !== docId));
    logger.log(`Removed doc: ${category}/${docId}`);
    return true;
  } catch (e) {
    logger.error("Failed to remove doc:", (e as Error).message);
    return false;
  }
}

/**
 * Find an existing document by filename within a category (for deduplication).
 */
export async function findDocByFilename(store: any, category: string, filename: string): Promise<DocSummary | null> {
  const summaries = await getAllSummaries(store, category);
  return summaries.find((s) => s.filename === filename) ?? null;
}
