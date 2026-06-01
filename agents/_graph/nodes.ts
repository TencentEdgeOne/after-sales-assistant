/**
 * Graph nodes — each node is a function (state) => partial state update.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createModel, createLogger } from "../_shared";
import type { AfterSalesStateType } from "./state";
import { getAllSummaries, getDocContent, saveDoc } from "../../lib/doc-store";
import { MOCK_ORDERS } from "../_data/orders";

const logger = createLogger("nodes");

// ─── Blob Order Helpers ───

/**
 * Regex that matches real customer order IDs (e.g. ORD-20250520-001).
 * Only blob summaries whose filename matches this pattern are treated as
 * customer orders. Policy/process docs that were mistakenly uploaded under
 * category "order_doc" will NOT match and will therefore be filtered out.
 */
const ORDER_FILENAME_RE = /^ORD-\d{8}-\d{3,}/i;

/** Filter blob summaries to real order documents only. */
function filterOrderSummaries(summaries: Awaited<ReturnType<typeof getAllSummaries>>) {
  return summaries.filter(s => ORDER_FILENAME_RE.test(s.filename));
}

/**
 * Look up an order from the Blob knowledge base (order_doc category).
 * Matches by filename (== orderId) or keywords containing the orderId.
 */
async function lookupBlobOrderDoc(orderId: string): Promise<{
  content: string;
  docId: string;
  summary: string;
  keywords: string[];
  filename: string;
} | null> {
  try {
    const summaries = await getAllSummaries("order_doc");
    const needle = orderId.toUpperCase();
    const matchedDoc = summaries.find(
      s =>
        s.filename.toUpperCase() === needle ||
        s.keywords.some(k => k.toUpperCase() === needle)
    );
    if (!matchedDoc) return null;
    const content = await getDocContent("order_doc", matchedDoc.docId);
    if (!content) return null;
    return {
      content,
      docId: matchedDoc.docId,
      summary: matchedDoc.summary,
      keywords: matchedDoc.keywords,
      filename: matchedDoc.filename,
    };
  } catch {
    return null;
  }
}

/**
 * Detect order status from free-text document content / keywords.
 */
function detectStatusFromText(text: string): string {
  const t = text;
  if (t.includes("换货申请") || t.includes("exchange_requested")) return "exchange_requested";
  if (t.includes("退款申请") || t.includes("退款中") || t.includes("refund_requested")) return "refund_requested";
  if (t.includes("已签收") || t.includes("已收货") || t.includes("签收") || t.includes("delivered")) return "delivered";
  if (t.includes("运输中") || t.includes("已发货") || t.includes("在途") || t.includes("shipped")) return "shipped";
  if (t.includes("待发货") || t.includes("未发货") || t.includes("pending")) return "pending";
  return "unknown";
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待发货",
  shipped: "运输中",
  delivered: "已签收",
  refund_requested: "退款申请中",
  refund_approved: "退款已批准",
  refund_completed: "退款已完成",
  exchange_requested: "换货申请中",
  exchange_shipped: "换货已寄出",
  unknown: "状态未知",
};

// ─── Intent Recognition ───

export async function intentRecognition(state: AfterSalesStateType) {
  // If the previous turn was waiting for user to pick an order (exchange/refund flow),
  // and the user's message looks like an order ID, skip LLM and carry forward the intent.
  const ORDER_ID_RE = /ORD-\d{8}-\d{3}/i;
  if (
    state.waitingForUser &&
    (state.intent === "exchange" || state.intent === "refund") &&
    ORDER_ID_RE.test(state.userInput.trim())
  ) {
    const orderId = state.userInput.trim().match(ORDER_ID_RE)![0].toUpperCase();
    logger.log(`Context carry-forward: intent=${state.intent}, orderId=${orderId}`);
    return { intent: state.intent, orderId, waitingForUser: false };
  }
  const model = createModel();
  const response = await model.invoke([
    new SystemMessage(`你是一个售后客服意图分类器。根据用户消息判断意图，输出 JSON：
{"intent": "faq"|"lookup_order"|"refund"|"exchange"|"general", "orderId": "如有提到订单号则提取，否则null", "reason": "简要说明"}

意图说明：
- faq: 用户询问政策/规则/流程/产品信息（退货政策、运费、保修、产品使用说明等）——覆盖知识库中所有文档类别（faq/policy/product/order_doc）
- lookup_order: 用户要查订单状态/物流
- refund: 用户要退货或退款
- exchange: 用户要换货
- general: 闲聊/打招呼/其他

如果用户同时提到订单号和退货，优先判断为 refund/exchange。`),
    new HumanMessage(state.userInput),
  ]);

  const text = typeof response.content === "string" ? response.content : "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      logger.log(`Intent: ${parsed.intent}, orderId: ${parsed.orderId}`);
      return {
        intent: parsed.intent || "general",
        // Only update orderId if LLM extracted a new one; otherwise keep existing context
        orderId: parsed.orderId || state.orderId || null,
      };
    }
  } catch {}
  return { intent: "general" as const, orderId: state.orderId || null };
}

// ─── FAQ Search (Knowledge Base) ───

export async function faqSearch(state: AfterSalesStateType) {
  // Step 1: Get all document summaries across all categories
  const summaries = await getAllSummaries();
  logger.log(`Knowledge base has ${summaries.length} documents`);

  if (summaries.length === 0) {
    return {
      aiResponse: "抱歉，知识库中暂无相关文档。您可以换个方式描述问题，或者直接告诉我您的订单号，我来帮您处理。",
      faqResults: [],
      cardEvent: null,
    };
  }

  // Step 2: Use LLM to route — pick 1-3 most relevant docs
  const model = createModel();
  const summaryList = summaries.map((s, i) => `[${i}] 【${s.category}】${s.filename}: ${s.summary} (关键词: ${s.keywords.join(", ")})`).join("\n");

  const routeResponse = await model.invoke([
    new SystemMessage(`你是一个文档路由助手。根据用户问题，从以下文档列表中选择 1-3 个最相关的文档。
返回严格 JSON 格式：{"indices": [0, 2]}（文档的序号列表）

如果没有相关文档，返回：{"indices": []}

文档列表：
${summaryList}`),
    new HumanMessage(state.userInput),
  ]);

  const routeText = typeof routeResponse.content === "string" ? routeResponse.content : "";
  let selectedIndices: number[] = [];

  try {
    const match = routeText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.indices)) {
        selectedIndices = parsed.indices.filter((i: number) => i >= 0 && i < summaries.length);
      }
    }
  } catch {}

  if (selectedIndices.length === 0) {
    return {
      aiResponse: "抱歉，我没有找到与您问题相关的文档信息。您可以换个方式描述问题，或者直接告诉我您的订单号，我来帮您处理。",
      faqResults: [],
      cardEvent: null,
    };
  }

  // Step 3: Load full content for selected docs
  const selectedDocs = selectedIndices.map(i => summaries[i]);
  const contents = await Promise.all(
    selectedDocs.map(async (doc) => {
      const content = await getDocContent(doc.category, doc.docId);
      return { ...doc, content: content || doc.summary };
    })
  );

  logger.log(`Selected ${contents.length} docs for answer generation`);

  // Step 4: Generate answer from context
  const context = contents.map(d => `【${d.category}/${d.filename}】\n${d.content}`).join("\n\n");

  const response = await model.invoke([
    new SystemMessage(`你是售后客服助手。根据以下知识库文档回答用户问题。
要求：
- 简洁友好，不要照搬原文
- 如果涉及具体操作，给出清晰步骤
- 如果用户需要进一步帮助，引导他提供订单号
- 注明信息来源的文档类别

知识库文档：
${context}`),
    new HumanMessage(state.userInput),
  ]);

  const answer = typeof response.content === "string" ? response.content : "";
  return {
    aiResponse: answer,
    faqResults: contents.map(d => ({ id: d.docId, title: d.filename, content: d.content })),
    cardEvent: {
      type: "faq_sources",
      data: { sources: selectedDocs.map(d => ({ id: d.docId, title: d.filename, category: d.category })) },
    },
  };
}

// ─── Lookup Order ───

export async function lookupOrder(state: AfterSalesStateType) {
  const orderId = state.orderId;

  if (!orderId) {
    // Show MOCK orders + Blob order_doc list (real orders only)
    const blobSummaries = filterOrderSummaries(await getAllSummaries("order_doc"));

    const mockLines = MOCK_ORDERS.map(o => {
      const itemNames = o.items.map(i => i.name).join("、");
      return `- **${o.orderId}**：${itemNames}（${STATUS_LABELS[o.status] || o.status}，¥${o.totalAmount}）`;
    });

    const blobLines = blobSummaries.map(s => {
      const status = detectStatusFromText(s.summary + " " + s.keywords.join(" "));
      return `- **${s.filename}**：${s.summary.slice(0, 40)}（${STATUS_LABELS[status] || status}）`;
    });

    const allLines = [...mockLines, ...blobLines].join("\n");

    return {
      aiResponse: `您有以下订单，请告诉我要查询哪一个：\n\n${allLines}`,
      waitingForUser: true,
      cardEvent: null,
    };
  }

  // Use currentOrder from state if matches, otherwise lookup from mock data
  let order = (state.currentOrder?.orderId === orderId) ? state.currentOrder : null;
  if (!order) {
    order = MOCK_ORDERS.find(o => o.orderId === orderId) || null;
  }

  if (!order) {
    // Fallback: search knowledge base order_doc for custom-imported orders
    const blobDoc = await lookupBlobOrderDoc(orderId);
    if (blobDoc) {
      return {
        aiResponse: `已找到订单 **${orderId}** 的信息：\n\n${blobDoc.content}`,
        cardEvent: null,
      };
    }

    return {
      aiResponse: `抱歉，没有找到订单 ${orderId}。请确认订单号是否正确。您可以尝试：ORD-20250520-001、ORD-20250518-002、ORD-20250515-003`,
      currentOrder: null,
      cardEvent: null,
    };
  }

  return {
    currentOrder: order,
    aiResponse: `已找到您的订单 ${order.orderId}，当前状态：**${STATUS_LABELS[order.status] || order.status}**。${order.trackingNumber ? `\n快递：${order.carrier} ${order.trackingNumber}` : ""}`,
    cardEvent: { type: "order_detail", data: { order } },
  };
}

// ─── Request Refund ───

export async function requestRefund(state: AfterSalesStateType) {
  if (!state.currentOrder && !state.orderId) {
    // Show MOCK orders + Blob order_doc, marking eligibility (real orders only)
    const blobSummaries = filterOrderSummaries(await getAllSummaries("order_doc"));

    const mockLines = MOCK_ORDERS.map(o => {
      const itemNames = o.items.map(i => i.name).join("、");
      const eligible = o.status === "delivered" || o.status === "shipped";
      const status = STATUS_LABELS[o.status] || o.status;
      const note = eligible ? "" : ` *(${status}，暂不可退款)*`;
      return `- **${o.orderId}**：${itemNames}（¥${o.totalAmount}）${note}`;
    });

    const blobLines = blobSummaries.map(s => {
      const status = detectStatusFromText(s.summary + " " + s.keywords.join(" "));
      const eligible = status === "delivered" || status === "shipped";
      const statusLabel = STATUS_LABELS[status] || status;
      const note = eligible ? "" : ` *(${statusLabel}，暂不可退款)*`;
      return `- **${s.filename}**：${s.summary.slice(0, 30)}...${note}`;
    });

    const allLines = [...mockLines, ...blobLines].join("\n");
    return {
      aiResponse: `请选择需要退款的订单（运输中或已签收的订单支持退款申请）：\n\n${allLines}\n\n请回复订单号即可。`,
      waitingForUser: true,
      cardEvent: null,
    };
  }

  let order = state.currentOrder;
  if (!order && state.orderId) {
    order = MOCK_ORDERS.find(o => o.orderId === state.orderId) || null;
  }

  if (!order) {
    // Fallback: look up in Blob order_doc
    const orderId = state.orderId!;
    const blobDoc = await lookupBlobOrderDoc(orderId);
    if (blobDoc) {
      const status = detectStatusFromText(blobDoc.content + " " + blobDoc.keywords.join(" "));

      if (status === "refund_requested" || status === "refund_completed") {
        return {
          aiResponse: `订单 ${orderId} 已有退款记录，无需重复申请。\n\n订单详情：\n${blobDoc.content}`,
          cardEvent: null,
        };
      }

      if (status !== "delivered" && status !== "shipped") {
        return {
          aiResponse: `订单 ${orderId} 当前状态为「${STATUS_LABELS[status] || status}」，暂不支持退款。已签收或运输中的订单方可申请退款。\n\n订单详情：\n${blobDoc.content}`,
          cardEvent: null,
        };
      }

      // Process refund — update Blob doc to mark as refund_requested
      const updatedContent = `${blobDoc.content}\n\n---\n退款申请已提交（${new Date().toISOString().split("T")[0]}）`;
      try {
        await saveDoc("order_doc", blobDoc.docId, blobDoc.filename, updatedContent, blobDoc.summary, [
          ...blobDoc.keywords.filter(k => !k.includes("退款") && !k.includes("换货")),
          "退款申请中",
        ]);
      } catch {}

      return {
        aiResponse: `退款申请已提交！\n\n- 订单：${orderId}\n- 预计 3-5 个工作日退回原支付方式\n\n如为质量问题，我们将提供免费取件服务。`,
        cardEvent: {
          type: "refund_progress",
          data: {
            order: {
              orderId,
              status: "refund_requested",
              refundReason: "用户申请退货退款",
              refundAmount: 0,
              totalAmount: 0,
              items: [{ name: "商品（详见订单文档）" }],
              updatedAt: new Date().toISOString(),
            },
          },
        },
      };
    }

    return { aiResponse: `未找到订单 ${state.orderId}，请核实订单号。`, cardEvent: null };
  }

  if (order.status === "refund_requested" || order.status === "refund_approved" || order.status === "refund_completed") {
    return {
      aiResponse: `订单 ${order.orderId} 已有退款记录（当前状态：${STATUS_LABELS[order.status]}），无需重复申请。`,
      currentOrder: order,
      cardEvent: { type: "refund_progress", data: { order } },
    };
  }

  if (order.status !== "delivered" && order.status !== "shipped") {
    return {
      aiResponse: `订单 ${order.orderId} 当前状态为「${STATUS_LABELS[order.status] || order.status}」，暂不支持退款。已签收或运输中的订单方可申请退款。`,
      cardEvent: null,
    };
  }

  // Process refund
  const updatedOrder = {
    ...order,
    status: "refund_requested" as const,
    refundReason: state.refundReason || "用户申请退货退款",
    refundAmount: order.totalAmount,
    updatedAt: new Date().toISOString(),
  };

  return {
    currentOrder: updatedOrder,
    aiResponse: `退款申请已提交！\n\n- 订单：${updatedOrder.orderId}\n- 退款金额：¥${updatedOrder.refundAmount}\n- 预计 3-5 个工作日退回原支付方式\n\n如为质量问题，我们将提供免费取件服务。`,
    cardEvent: { type: "refund_progress", data: { order: updatedOrder } },
  };
}

// ─── Request Exchange ───

export async function requestExchange(state: AfterSalesStateType) {
  if (!state.currentOrder && !state.orderId) {
    // Show MOCK orders + Blob order_doc, marking eligibility (real orders only)
    const blobSummaries = filterOrderSummaries(await getAllSummaries("order_doc"));

    const mockLines = MOCK_ORDERS.map(o => {
      const itemNames = o.items.map(i => i.name).join("、");
      const eligible = o.status === "delivered";
      const status = STATUS_LABELS[o.status] || o.status;
      const note = eligible ? "" : ` *(${status}，暂不可换货)*`;
      return `- **${o.orderId}**：${itemNames}（¥${o.totalAmount}）${note}`;
    });

    const blobLines = blobSummaries.map(s => {
      const status = detectStatusFromText(s.summary + " " + s.keywords.join(" "));
      const eligible = status === "delivered";
      const statusLabel = STATUS_LABELS[status] || status;
      const note = eligible ? "" : ` *(${statusLabel}，暂不可换货)*`;
      return `- **${s.filename}**：${s.summary.slice(0, 30)}...${note}`;
    });

    const allLines = [...mockLines, ...blobLines].join("\n");
    return {
      aiResponse: `请选择需要换货的订单（仅已签收的订单支持换货申请）：\n\n${allLines}\n\n请回复订单号即可。`,
      waitingForUser: true,
      cardEvent: null,
    };
  }

  let order = state.currentOrder;
  if (!order && state.orderId) {
    order = MOCK_ORDERS.find(o => o.orderId === state.orderId) || null;
  }

  if (!order) {
    // Fallback: look up in Blob order_doc
    const orderId = state.orderId!;
    const blobDoc = await lookupBlobOrderDoc(orderId);
    if (blobDoc) {
      const status = detectStatusFromText(blobDoc.content + " " + blobDoc.keywords.join(" "));

      if (status === "exchange_requested") {
        return {
          aiResponse: `订单 ${orderId} 已有换货申请记录，无需重复申请。\n\n订单详情：\n${blobDoc.content}`,
          cardEvent: null,
        };
      }

      if (status !== "delivered") {
        return {
          aiResponse: `订单 ${orderId} 当前状态为「${STATUS_LABELS[status] || status}」，仅已签收的商品支持换货。\n\n订单详情：\n${blobDoc.content}`,
          cardEvent: null,
        };
      }

      // Process exchange — update Blob doc to mark as exchange_requested
      const updatedContent = `${blobDoc.content}\n\n---\n换货申请已提交（${new Date().toISOString().split("T")[0]}）`;
      try {
        await saveDoc("order_doc", blobDoc.docId, blobDoc.filename, updatedContent, blobDoc.summary, [
          ...blobDoc.keywords.filter(k => !k.includes("退款") && !k.includes("换货")),
          "换货申请中",
        ]);
      } catch {}

      return {
        aiResponse: `换货申请已提交！\n\n- 订单：${orderId}\n- 处理周期：收到旧件后 3 个工作日寄出新件\n\n请将商品保持全新状态并附带完整包装寄回。`,
        cardEvent: {
          type: "exchange_confirm",
          data: {
            order: {
              orderId,
              status: "exchange_requested",
              items: [{ name: "商品（详见订单文档）", specs: "-" }],
              exchangeReason: state.exchangeTarget || "用户申请换货",
              updatedAt: new Date().toISOString(),
            },
          },
        },
      };
    }

    return { aiResponse: `未找到订单 ${state.orderId}，请核实订单号。`, cardEvent: null };
  }

  if (order.status !== "delivered") {
    return {
      aiResponse: `订单 ${order.orderId} 当前状态为「${STATUS_LABELS[order.status] || order.status}」，仅已签收的商品支持换货。`,
      cardEvent: null,
    };
  }

  const updatedOrder = {
    ...order,
    status: "exchange_requested" as const,
    exchangeReason: state.exchangeTarget || "用户申请换货",
    updatedAt: new Date().toISOString(),
  };

  return {
    currentOrder: updatedOrder,
    aiResponse: `换货申请已提交！\n\n- 订单：${updatedOrder.orderId}\n- 商品：${order.items.map(i => i.name).join("、")}\n- 处理周期：收到旧件后 3 个工作日寄出新件\n\n请将商品保持全新状态并附带完整包装寄回。`,
    cardEvent: { type: "exchange_confirm", data: { order: updatedOrder } },
  };
}

// ─── General Chat ───

export async function generalChat(state: AfterSalesStateType) {
  const model = createModel();
  const response = await model.invoke([
    new SystemMessage(`你是一个友好的售后客服助手。可以帮助用户：
- 查询订单状态（需要订单号）
- 申请退货/退款
- 申请换货
- 回答售后政策问题

如果用户的问题模糊，引导他们提供更多信息。保持简洁友好。`),
    new HumanMessage(state.userInput),
  ]);
  return {
    aiResponse: typeof response.content === "string" ? response.content : "",
    cardEvent: null,
  };
}
