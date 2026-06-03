/**
 * Main Chat Agent — After-Sales Assistant
 *
 * Uses LangGraph for intent routing + tool execution.
 * Emits SSE events including UI card events for the frontend to render.
 */
import { createLogger, createSSEResponse, sseEvent, saveOrder, getOrder } from "../_shared";
import { buildAfterSalesGraph } from "../_graph/builder";
import { setGlobalStore } from "../../lib/doc-store";
import type { AfterSalesStateType } from "../_graph/state";

const logger = createLogger("chat");

const STEP_LABELS: Record<string, string> = {
  intent_recognition: "正在理解您的问题...",
  faq_search: "正在查找相关政策...",
  lookup_order: "正在查询订单...",
  request_refund: "正在处理退款申请...",
  request_exchange: "正在处理换货申请...",
  general_chat: "正在思考...",
};

// ─── State Persistence ───

const STATE_NAMESPACE = ["aftersales", "workflow"];

async function loadState(context: any, threadId: string): Promise<Partial<AfterSalesStateType> | null> {
  try {
    const item = await context.store.langgraphStore.get(STATE_NAMESPACE, threadId);
    if (item?.value) return item.value as Partial<AfterSalesStateType>;
  } catch {}
  return null;
}

async function saveState(context: any, threadId: string, state: Partial<AfterSalesStateType>): Promise<void> {
  try {
    await context.store.langgraphStore.put(STATE_NAMESPACE, threadId, { ...state });
  } catch (e) {
    logger.error("Failed to save state:", e);
  }
}

// ─── SSE Stream ───

async function* streamAfterSales(
  userMessage: string,
  context: any,
  pendingAction: { intent: string } | null,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const conversationId = context.conversation_id || "default";

  // Make store available to graph nodes (nodes can't receive context directly)
  setGlobalStore(context.store);

  const graph = buildAfterSalesGraph();

  // Load prior state (for multi-turn: keep currentOrder context)
  const priorState = await loadState(context, conversationId);

  // Pre-load order from store if we have an orderId (since graph nodes can't access context)
  let preloadedOrder = priorState?.currentOrder || null;
  if (priorState?.orderId && !preloadedOrder) {
    preloadedOrder = await getOrder(context, priorState.orderId) || null;
  }

  // pendingAction from request body takes highest priority (most reliable cross-turn context)
  const restoredIntent = (pendingAction?.intent as AfterSalesStateType["intent"]) ?? priorState?.intent ?? null;
  const restoredWaiting = pendingAction ? true : (priorState?.waitingForUser ?? false);

  const input: Partial<AfterSalesStateType> = {
    ...(priorState || pendingAction ? {
      currentOrder: preloadedOrder,
      orderId: priorState?.orderId,
      // Restore conversation context so intent recognition can use it
      intent: restoredIntent,
      waitingForUser: restoredWaiting,
    } : {}),
    userInput: userMessage,
    aiResponse: "",
    cardEvent: null,
  };

  const stream = await graph.stream(input, { signal });
  let lastState: Partial<AfterSalesStateType> = { ...input };

  for await (const event of stream) {
    if (signal?.aborted) break;

    for (const [nodeName, output] of Object.entries(event)) {
      const nodeOutput = output as Partial<AfterSalesStateType>;
      lastState = { ...lastState, ...nodeOutput };

      // Emit workflow step
      const label = STEP_LABELS[nodeName] || nodeName;
      yield sseEvent({ type: "workflow_step", step: nodeName, label });

      // Emit card event if present
      if (nodeOutput.cardEvent) {
        yield sseEvent({ type: "card", cardType: nodeOutput.cardEvent.type, data: nodeOutput.cardEvent.data });
      }

      // Emit AI text response
      if (nodeOutput.aiResponse && nodeOutput.aiResponse.trim()) {
        yield sseEvent({ type: "ai_response", content: nodeOutput.aiResponse });
      }
    }
  }

  // Save state for next turn (include intent + waitingForUser for context continuity)
  await saveState(context, conversationId, {
    currentOrder: lastState.currentOrder,
    orderId: lastState.orderId,
    intent: lastState.intent,
    waitingForUser: lastState.waitingForUser,
  });

  // Persist order changes (refund/exchange status) — graph nodes can't access context directly
  if (lastState.currentOrder && (
    lastState.currentOrder.status === "refund_requested" ||
    lastState.currentOrder.status === "exchange_requested"
  )) {
    await saveOrder(context, lastState.currentOrder as any);
    logger.log(`Order ${lastState.currentOrder.orderId} status updated to ${lastState.currentOrder.status}`);
  }

  // Save to memory
  try {
    await context.store.appendMessage({ conversationId, role: "user", content: userMessage });
    if (lastState.aiResponse) {
      await context.store.appendMessage({ conversationId, role: "assistant", content: lastState.aiResponse });
    }
  } catch {}

  // Emit smart follow-up suggestions based on the completed action
  const suggestions = generateSuggestions(lastState);
  if (suggestions.length > 0) {
    yield sseEvent({ type: "suggest_actions", actions: suggestions });
  }

  // Emit pending_action if we're waiting for user to pick an order (reliable cross-turn context)
  if (lastState.waitingForUser && lastState.intent) {
    yield sseEvent({ type: "pending_action", intent: lastState.intent });
  }

  yield sseEvent({ type: "status", status: "complete" });
  yield "data: [DONE]\n\n";
}

// ─── HTTP Handler ───

export async function onRequest(context: any) {
  const { request } = context;
  const body = request?.body ?? {};
  const { message, pendingAction } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: "Missing message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.AI_GATEWAY_API_KEY || !process.env.AI_GATEWAY_BASE_URL) {
    return new Response(JSON.stringify({
      error: "Service not configured. Please set AI_GATEWAY_API_KEY and AI_GATEWAY_BASE_URL environment variables.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  logger.log(`Chat: "${(message as string).slice(0, 80)}..."`);

  const signal = request?.signal as AbortSignal | undefined;
  const generator = streamAfterSales(message, context, pendingAction ?? null, signal);
  return createSSEResponse(generator, signal);
}

// ─── Smart Suggestions ───

function generateSuggestions(state: Partial<AfterSalesStateType>): Array<{ id: string; emoji: string; title: string; action?: string }> {
  const intent = state.intent;
  const order = state.currentOrder;
  const orderId = state.orderId;

  if (intent === "lookup_order") {
    if (order && orderId) {
      if (order.status === "delivered") {
        return [
          { id: "refund", emoji: "💰", title: "我要退款", action: `我要退 ${orderId} 的款` },
          { id: "exchange", emoji: "🔄", title: "我要换货", action: `我要换 ${orderId} 的货` },
        ];
      }
      if (order.status === "shipped") {
        return [
          { id: "refund", emoji: "💰", title: "我要退款", action: `我要退 ${orderId} 的款` },
          { id: "delivery", emoji: "🚚", title: "预计什么时候到？", action: `${orderId} 预计什么时候到？` },
        ];
      }
      if (order.status === "pending") {
        return [
          { id: "eta", emoji: "📦", title: "什么时候发货？", action: `${orderId} 什么时候发货？` },
          { id: "cancel", emoji: "❌", title: "我想取消订单", action: `我想取消订单 ${orderId}` },
        ];
      }
      // refund_requested / exchange_requested
      return [
        { id: "status", emoji: "🔔", title: "最新进度怎么样？", action: `${orderId} 最新进度怎么样？` },
        { id: "other", emoji: "🔍", title: "查询其他订单" },
      ];
    }
    // No specific order found — general suggestions
    return [
      { id: "faq", emoji: "📋", title: "售后政策咨询" },
      { id: "refund", emoji: "💰", title: "我要申请退款" },
    ];
  }

  if (intent === "refund") {
    return [
      { id: "timeline", emoji: "⏰", title: "退款多久到账？" },
      { id: "other", emoji: "🔍", title: "查询其他订单" },
    ];
  }

  if (intent === "exchange") {
    return [
      { id: "address", emoji: "📮", title: "寄回地址是哪里？" },
      { id: "timeline", emoji: "⏰", title: "换货需要多久？" },
    ];
  }

  if (intent === "faq") {
    return [
      { id: "order", emoji: "🔍", title: "查询我的订单" },
      { id: "refund", emoji: "💰", title: "申请退款" },
    ];
  }

  return [];
}
