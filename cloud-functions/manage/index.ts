/**
 * Document Management — list, get, delete, edit documents in the knowledge base.
 *
 * Accepts POST with `action` field:
 * - action: "list" + optional category → return all docs (or filtered)
 * - action: "get" + docId + category → return doc content + summary
 * - action: "delete" + docId + category → remove doc
 * - action: "edit" + docId + category + content + title → update content, regenerate summary
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createModel } from "../../agents/_shared";
import {
  getAllSummaries,
  getDocContent,
  removeDoc,
  saveDoc,
  type DocCategory,
} from "../../lib/doc-store";



const VALID_CATEGORIES: DocCategory[] = ["faq", "policy", "product", "order_doc"];

// Order ID pattern (e.g. ORD-20250520-001) — same as backend nodes.ts
const ORDER_FILENAME_RE = /^ORD-\d{8}-\d{3,}/i;

/** Parse structured fields from a free-text order_doc body. Bilingual keywords. */
function parseOrderDocFields(content: string): {
  totalAmount?: number;
  carrier?: string;
  trackingNumber?: string;
  itemNames?: string;
  status?: string;
} {
  const result: any = {};

  // 金额：¥1299  / Amount: ¥1299
  const amountMatch = content.match(/(?:金额|Amount|Total)[：:]\s*¥?\s*(\d+(?:\.\d+)?)/i);
  if (amountMatch) result.totalAmount = parseFloat(amountMatch[1]);

  // 快递：顺丰速运 SF1234567890  / Shipping: SF Express SF1234567890
  const expressMatch = content.match(/(?:快递|Shipping|Carrier)[：:]\s*(\S+?)\s+([A-Za-z0-9-]+)/i);
  if (expressMatch) {
    result.carrier = expressMatch[1];
    result.trackingNumber = expressMatch[2];
  } else {
    const carrierOnly = content.match(/(?:快递|Shipping|Carrier)[：:]\s*(\S+)/i);
    if (carrierOnly) result.carrier = carrierOnly[1];
  }

  // 商品：xxx  / Product: xxx
  const productMatch = content.match(/(?:商品|Product|Item)[：:]\s*([^\n]+)/i);
  if (productMatch) result.itemNames = productMatch[1].trim();

  const lower = content.toLowerCase();
  if (content.includes("换货申请") || lower.includes("exchange request") || lower.includes("exchange_requested")) result.status = "exchange_requested";
  else if (content.includes("退款申请") || content.includes("退款中") || lower.includes("refund request") || lower.includes("refund_requested")) result.status = "refund_requested";
  else if (content.includes("已签收") || content.includes("已收货") || content.includes("签收") || lower.includes("delivered")) result.status = "delivered";
  else if (content.includes("运输中") || content.includes("已发货") || content.includes("在途") || lower.includes("shipped") || lower.includes("in transit")) result.status = "shipped";
  else if (content.includes("待发货") || content.includes("未发货") || lower.includes("pending")) result.status = "pending";

  return result;
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Regenerate summary for updated content.
 */
async function regenerateSummary(
  content: string,
  filename: string,
  category: string,
  env: Record<string, string | undefined>
): Promise<{ summary: string; keywords: string[] }> {
  const model = createModel(env);
  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n...[truncated]" : content;

  const response = await model.invoke([
    new SystemMessage(`你是一个文档摘要助手。给定一个文档，生成：
1. 简明摘要（200字以内），概述核心内容和用途。
2. 5-10个关键词，涵盖文档的主要主题。

文档分类：${category}

输出严格 JSON 格式（不含其他文本）：
{"summary": "...", "keywords": ["关键词1", "关键词2", ...]}`),
    new HumanMessage(`文件名: ${filename}\n\n文档内容:\n${truncated}`),
  ]);

  const text = typeof response.content === "string" ? response.content : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || text.slice(0, 400),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      };
    }
  } catch {}

  return { summary: text.slice(0, 400), keywords: [] };
}

export async function onRequest(context: any) {
  const { request } = context;
  const env = context.env ?? {};
  const body = request?.body ?? {};
  const { action, category, docId, content, title } = body;

  // Get store (cloud-functions use context.agent?.store)
  const store = context.agent?.store ?? null;
  if (!store) {
    return jsonResponse({ error: "STORE_NOT_CONFIGURED", message: "Storage is not available. Deploy to EdgeOne Makers for automatic configuration." }, 503);
  }

  if (!action) {
    return jsonResponse({ error: "Missing action field" }, 400);
  }

  try {
    switch (action) {
      // ─── List Documents ───
      case "list": {
        if (category && !VALID_CATEGORIES.includes(category)) {
          return jsonResponse({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }, 400);
        }
        const summaries = await getAllSummaries(store, category);

        // Enrich order_doc entries (with order-id filename) with parsed fields
        const enriched = await Promise.all(
          summaries.map(async (s) => {
            if (s.category === "order_doc" && ORDER_FILENAME_RE.test(s.filename)) {
              const content = await getDocContent(store, s.category, s.docId);
              if (content) {
                return { ...s, ...parseOrderDocFields(content) };
              }
            }
            return s;
          })
        );

        return jsonResponse({
          success: true,
          documents: enriched,
          total: enriched.length,
        });
      }

      // ─── Get Document ───
      case "get": {
        if (!docId || !category) {
          return jsonResponse({ error: "Missing docId or category" }, 400);
        }
        const docContent = await getDocContent(store, category, docId);
        if (!docContent) {
          return jsonResponse({ error: `Document not found: ${category}/${docId}` }, 404);
        }
        const allSummaries = await getAllSummaries(store, category);
        const summary = allSummaries.find(s => s.docId === docId) || null;

        return jsonResponse({
          success: true,
          docId,
          category,
          content: docContent,
          summary: summary?.summary || "",
          keywords: summary?.keywords || [],
          filename: summary?.filename || "",
          charCount: docContent.length,
        });
      }

      // ─── Delete Document ───
      case "delete": {
        if (!docId || !category) {
          return jsonResponse({ error: "Missing docId or category" }, 400);
        }
        const deleted = await removeDoc(store, category, docId);
        if (!deleted) {
          return jsonResponse({ error: `Failed to delete document: ${category}/${docId}` }, 404);
        }
        console.log(`[manage] Deleted document: ${category}/${docId}`);
        return jsonResponse({ success: true, docId, category });
      }

      // ─── Edit Document ───
      case "edit": {
        if (!docId || !category || !content) {
          return jsonResponse({ error: "Missing docId, category, or content" }, 400);
        }
        if (!VALID_CATEGORIES.includes(category)) {
          return jsonResponse({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }, 400);
        }

        const docFilename = title || `${docId}.txt`;

        await removeDoc(store, category, docId);

        console.log(`[manage] Regenerating summary for ${category}/${docId}...`);
        const { summary, keywords } = await regenerateSummary(content, docFilename, category, env);

        await saveDoc(store, category as DocCategory, docId, docFilename, content, summary, keywords);

        console.log(`[manage] Updated document: ${category}/${docId}`);
        return jsonResponse({
          success: true,
          docId,
          category,
          filename: docFilename,
          summary,
          keywords,
          charCount: content.length,
        });
      }

      // ─── List Orders ───
      case "list_orders": {
        const kv = store?.langgraphStore ?? store;
        const ORDERS_NS = ["aftersales", "orders"];
        const MANIFEST_NS = ["aftersales", "orders_manifest"];
        const idx = await kv.get(MANIFEST_NS, "all").catch(() => null);
        const ids: string[] = idx?.value?.ids || [];
        console.log(`[manage] list_orders: manifest has ${ids.length} ids`);
        const orders = await Promise.all(
          ids.map(async (id: string) => {
            const item = await kv.get(ORDERS_NS, id).catch(() => null);
            return item?.value || null;
          })
        );
        return jsonResponse({ success: true, orders: orders.filter(Boolean) });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}. Supported: list, get, delete, edit` }, 400);
    }
  } catch (e) {
    console.error(`[manage] Manage error (${action}):`, (e as Error).message);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
}
