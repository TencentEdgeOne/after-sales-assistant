/**
 * Main Chat Agent — After-Sales Assistant
 *
 * Uses LangGraph for intent routing + tool execution.
 * Emits SSE events including UI card events for the frontend to render.
 * All user-facing strings respect body.locale ("zh" | "en").
 */
import { createLogger, createSSEResponse, sseEvent, saveOrder, getOrder } from "../_shared";
import { buildAfterSalesGraph } from "../_graph/builder";
import { setGlobalStore } from "../../lib/doc-store";
import { t, getLocale, type Locale } from "../_i18n";
import type { AfterSalesStateType } from "../_graph/state";

const logger = createLogger("chat");

// Step keys map to nodeName → translation key
const STEP_KEYS: Record<string, string> = {
  intent_recognition: "step.intent_recognition",
  faq_search: "step.faq_search",
  lookup_order: "step.lookup_order",
  request_refund: "step.request_refund",
  request_exchange: "step.request_exchange",
  general_chat: "step.general_chat",
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
  locale: Locale,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const conversationId = context.conversation_id || "default";

  setGlobalStore(context.store);

  const graph = buildAfterSalesGraph(context.env ?? {});
  const priorState = await loadState(context, conversationId);

  let preloadedOrder = priorState?.currentOrder || null;
  if (priorState?.orderId && !preloadedOrder) {
    preloadedOrder = await getOrder(context, priorState.orderId) || null;
  }

  const restoredIntent = (pendingAction?.intent as AfterSalesStateType["intent"]) ?? priorState?.intent ?? null;
  const restoredWaiting = pendingAction ? true : (priorState?.waitingForUser ?? false);

  const input: Partial<AfterSalesStateType> = {
    ...(priorState || pendingAction ? {
      currentOrder: preloadedOrder,
      orderId: priorState?.orderId,
      intent: restoredIntent,
      waitingForUser: restoredWaiting,
    } : {}),
    userInput: userMessage,
    locale,
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

      const labelKey = STEP_KEYS[nodeName];
      const label = labelKey ? t(locale, labelKey) : nodeName;
      yield sseEvent({ type: "workflow_step", step: nodeName, label });

      if (nodeOutput.cardEvent) {
        yield sseEvent({ type: "card", cardType: nodeOutput.cardEvent.type, data: nodeOutput.cardEvent.data });
      }

      if (nodeOutput.aiResponse && nodeOutput.aiResponse.trim()) {
        yield sseEvent({ type: "ai_response", content: nodeOutput.aiResponse });
      }
    }
  }

  await saveState(context, conversationId, {
    currentOrder: lastState.currentOrder,
    orderId: lastState.orderId,
    intent: lastState.intent,
    waitingForUser: lastState.waitingForUser,
    locale,
  });

  if (lastState.currentOrder && (
    lastState.currentOrder.status === "refund_requested" ||
    lastState.currentOrder.status === "exchange_requested"
  )) {
    await saveOrder(context, lastState.currentOrder as any);
    logger.log(`Order ${lastState.currentOrder.orderId} status updated to ${lastState.currentOrder.status}`);
  }

  try {
    await context.store.appendMessage({ conversationId, role: "user", content: userMessage });
    if (lastState.aiResponse) {
      await context.store.appendMessage({ conversationId, role: "assistant", content: lastState.aiResponse });
    }
  } catch {}

  const suggestions = generateSuggestions(lastState, locale);
  if (suggestions.length > 0) {
    yield sseEvent({ type: "suggest_actions", actions: suggestions });
  }

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
  const locale = getLocale(body);
  if (!message) {
    return new Response(JSON.stringify({ error: "Missing message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const env = context.env ?? {};
  if (!env.AI_GATEWAY_API_KEY || !env.AI_GATEWAY_BASE_URL) {
    return new Response(JSON.stringify({
      error: "Service not configured. Please set AI_GATEWAY_API_KEY and AI_GATEWAY_BASE_URL environment variables.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  logger.log(`Chat (${locale}): "${(message as string).slice(0, 80)}..."`);

  const signal = request?.signal as AbortSignal | undefined;
  const generator = streamAfterSales(message, context, pendingAction ?? null, locale, signal);
  return createSSEResponse(generator, signal);
}

// ─── Smart Suggestions (locale-aware) ───

function generateSuggestions(state: Partial<AfterSalesStateType>, locale: Locale): Array<{ id: string; emoji: string; title: string; action?: string }> {
  const intent = state.intent;
  const order = state.currentOrder;
  const orderId = state.orderId;

  if (intent === "lookup_order") {
    if (order && orderId) {
      if (order.status === "delivered") {
        return [
          { id: "refund", emoji: "💰", title: t(locale, "sug.refund"), action: t(locale, "sug.refundActionTpl", { orderId }) },
          { id: "exchange", emoji: "🔄", title: t(locale, "sug.exchange"), action: t(locale, "sug.exchangeActionTpl", { orderId }) },
        ];
      }
      if (order.status === "shipped") {
        return [
          { id: "refund", emoji: "💰", title: t(locale, "sug.refund"), action: t(locale, "sug.refundActionTpl", { orderId }) },
          { id: "delivery", emoji: "🚚", title: t(locale, "sug.delivery"), action: t(locale, "sug.deliveryActionTpl", { orderId }) },
        ];
      }
      if (order.status === "pending") {
        return [
          { id: "eta", emoji: "📦", title: t(locale, "sug.eta"), action: t(locale, "sug.etaActionTpl", { orderId }) },
          { id: "cancel", emoji: "❌", title: t(locale, "sug.cancel"), action: t(locale, "sug.cancelActionTpl", { orderId }) },
        ];
      }
      return [
        { id: "status", emoji: "🔔", title: t(locale, "sug.status"), action: t(locale, "sug.statusActionTpl", { orderId }) },
        { id: "other", emoji: "🔍", title: t(locale, "sug.lookupOther") },
      ];
    }
    return [
      { id: "faq", emoji: "📋", title: t(locale, "sug.faqGeneral") },
      { id: "refund", emoji: "💰", title: t(locale, "sug.refundApply") },
    ];
  }

  if (intent === "refund") {
    return [
      { id: "timeline", emoji: "⏰", title: t(locale, "sug.timelineRefund") },
      { id: "other", emoji: "🔍", title: t(locale, "sug.lookupOther") },
    ];
  }

  if (intent === "exchange") {
    return [
      { id: "address", emoji: "📮", title: t(locale, "sug.address") },
      { id: "timeline", emoji: "⏰", title: t(locale, "sug.timelineExchange") },
    ];
  }

  if (intent === "faq") {
    return [
      { id: "order", emoji: "🔍", title: t(locale, "sug.lookupMyOrders") },
      { id: "refund", emoji: "💰", title: t(locale, "sug.refundApply") },
    ];
  }

  return [];
}
