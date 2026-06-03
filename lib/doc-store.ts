/**
 * Document Store — Multi-category storage for after-sales knowledge base.
 *
 * Uses context.agent.store.langgraphStore (proper KV store).
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
import { createLogger } from "../agents/_shared";

const logger = createLogger("doc-store");

// ─── Global store fallback (for graph nodes that can't receive context) ───

let _globalStore: any = null;

export function setGlobalStore(store: any): void {
  _globalStore = store;
}

export function getGlobalStore(): any {
  return _globalStore;
}

function resolveStore(arg1?: any, arg2?: string): [any, string | undefined] {
  if (arg1 === undefined || typeof arg1 === "string") {
    return [_globalStore, arg1 as string | undefined];
  }
  return [arg1, arg2];
}

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
  return store?.langgraphStore ?? store;
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
 * Overloaded: getAllSummaries() | getAllSummaries("cat") | getAllSummaries(store) | getAllSummaries(store, "cat")
 */
export async function getAllSummaries(arg1?: any, arg2?: string): Promise<DocSummary[]> {
  const [store, category] = resolveStore(arg1, arg2);
  const entries = await readManifest(store);
  if (!category) return entries;
  if (!ALL_CATEGORIES.includes(category as DocCategory)) return [];
  return entries.filter((e) => e.category === category);
}

/**
 * Get full document content by category and docId.
 * Overloaded: getDocContent(category, docId) | getDocContent(store, category, docId)
 */
export async function getDocContent(arg1: any, arg2: string, arg3?: string): Promise<string | null> {
  let store: any, category: string, docId: string;
  if (arg3 === undefined) {
    [store] = resolveStore();
    category = arg1;
    docId = arg2;
  } else {
    store = arg1;
    category = arg2;
    docId = arg3;
  }
  const rec = await getDocRecord(store, category, docId);
  return rec?.content ?? null;
}

/**
 * Save a document with its content and summary metadata.
 * Overloaded: saveDoc(category, docId, ...) | saveDoc(store, category, docId, ...)
 */
export async function saveDoc(
  arg1: any,
  arg2: DocCategory | string,
  arg3: string,
  arg4: string,
  arg5?: string,
  arg6?: string,
  arg7?: string[]
): Promise<void> {
  let store: any, category: DocCategory, docId: string, filename: string, content: string, summary: string, keywords: string[];
  if (arg5 === undefined) {
    throw new Error("saveDoc: insufficient arguments");
  }
  if (typeof arg1 === "string") {
    [store] = resolveStore();
    category = arg1 as DocCategory;
    docId = arg2 as string;
    filename = arg3;
    content = arg4;
    summary = arg5;
    keywords = (arg6 as unknown as string[]) || [];
  } else {
    store = arg1;
    category = arg2 as DocCategory;
    docId = arg3;
    filename = arg4;
    content = arg5;
    summary = arg6 || "";
    keywords = arg7 || [];
  }

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
