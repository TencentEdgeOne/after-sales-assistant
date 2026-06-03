/**
 * Seed demo documents into the knowledge base.
 * One-click import of sample after-sales documents.
 */
import { createLogger, createModel, createSSEResponse, sseEvent } from "../../agents/_shared";
import { DEMO_DOCS, DEMO_ORDERS } from "../../agents/_data/demo-docs";
import { saveDoc, getAllSummaries } from "../../lib/doc-store";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const logger = createLogger("seed-demo");

async function generateSummary(title: string, content: string): Promise<{ summary: string; keywords: string[] }> {
  const model = createModel();
  const response = await model.invoke([
    new SystemMessage(`为以下文档生成简短摘要（1-2句）和5个关键词。返回JSON：{"summary":"...","keywords":["k1","k2","k3","k4","k5"]}`),
    new HumanMessage(`标题：${title}\n\n内容：${content.slice(0, 1500)}`),
  ]);
  const text = typeof response.content === "string" ? response.content : "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return { summary: content.slice(0, 100), keywords: [title] };
}

async function* streamSeedDemo(store: any): AsyncGenerator<string> {
  const kv = store?.langgraphStore ?? store;

  const total = DEMO_DOCS.length + DEMO_ORDERS.length;
  yield sseEvent({ type: "progress", message: `开始导入 ${DEMO_DOCS.length} 篇文档 + ${DEMO_ORDERS.length} 个订单...`, total });

  let imported = 0;
  let failed = 0;

  // ─── Import knowledge base documents ───
  for (const doc of DEMO_DOCS) {
    const docId = `demo-${doc.category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    yield sseEvent({
      type: "progress",
      message: `[${imported + failed + 1}/${total}] 正在生成索引: ${doc.title}`,
      current: imported + failed + 1,
      total,
    });

    try {
      const { summary, keywords } = await generateSummary(doc.title, doc.content);
      await saveDoc(store, doc.category, docId, doc.title, doc.content, summary, keywords);
      imported++;
      yield sseEvent({ type: "doc_imported", docId, title: doc.title, category: doc.category, summary });
    } catch (e) {
      failed++;
      logger.error(`Failed to import ${doc.title}:`, (e as Error).message);
      yield sseEvent({ type: "doc_error", title: doc.title, error: (e as Error).message });
    }
  }

  // ─── Import demo orders (with manifest maintenance) ───
  const ORDERS_NS = ["aftersales", "orders"];
  const ORDERS_MANIFEST_NS = ["aftersales", "orders_manifest"];
  const importedOrderIds: string[] = [];

  // Read existing manifest first (so we merge instead of overwriting)
  let existingIds: string[] = [];
  try {
    const existingIdx = await kv.get(ORDERS_MANIFEST_NS, "all").catch(() => null);
    existingIds = existingIdx?.value?.ids || [];
  } catch {}

  for (const order of DEMO_ORDERS) {
    yield sseEvent({
      type: "progress",
      message: `[${imported + failed + 1}/${total}] 导入订单: ${order.orderId}`,
      current: imported + failed + 1,
      total,
    });

    try {
      await kv.put(ORDERS_NS, order.orderId, { ...order });
      importedOrderIds.push(order.orderId);

      // Update manifest after each successful order write (defensive — partial failure recovery)
      const allIds = [...new Set([...existingIds, ...importedOrderIds])];
      try {
        await kv.put(ORDERS_MANIFEST_NS, "all", { ids: allIds });
      } catch (e) {
        logger.error("Failed to update orders manifest:", (e as Error).message);
      }

      imported++;
      yield sseEvent({ type: "order_imported", title: order.orderId, category: "order" });
    } catch (e) {
      failed++;
      logger.error(`Failed to import order ${order.orderId}:`, (e as Error).message);
    }
  }

  logger.log(`Orders imported: ${importedOrderIds.length}, manifest now has ${importedOrderIds.length + existingIds.filter(id => !importedOrderIds.includes(id)).length} ids`);

  if (imported === 0 && failed > 0) {
    yield sseEvent({ type: "error_message", content: `导入失败，共 ${failed} 条数据写入出错，请检查存储配置。` });
  } else {
    yield sseEvent({ type: "progress", message: `导入完成！成功 ${imported} 条${failed > 0 ? `，失败 ${failed} 条` : ""}` });
    yield sseEvent({ type: "complete", total: imported, failed, skipped: false });
  }
  yield "data: [DONE]\n\n";
}

export async function onRequest(context: any) {
  if (!process.env.AI_GATEWAY_API_KEY || !process.env.AI_GATEWAY_BASE_URL) {
    return new Response(JSON.stringify({ error: "AI Gateway not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get store (cloud-functions use context.agent?.store)
  const store = context.agent?.store ?? context.store ?? null;
  if (!store) {
    return new Response(JSON.stringify({
      error: "STORE_NOT_CONFIGURED",
      message: "Storage is not available. Deploy to EdgeOne Makers for automatic configuration.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  logger.log("Seeding demo documents...");
  const signal = context.request?.signal as AbortSignal | undefined;
  const generator = streamSeedDemo(store);
  return createSSEResponse(generator, signal);
}
