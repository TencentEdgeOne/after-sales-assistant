/**
 * Test Agent — minimal endpoint to verify agent runtime is working.
 *
 * Purpose: rule out platform / bundling / config issues by running a single
 * LLM call with no graph / no SSE / no tools. If this works but /chat doesn't,
 * the issue is in chat-specific logic (LangGraph, persistence, etc.).
 * If this also fails, the issue is at the platform / dependency level.
 *
 * POST /test
 * Body: { message?: string }
 * Returns: { ok: boolean, reply?: string, error?: string, meta: {...} }
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

export async function onRequest(context: any) {
  const startedAt = Date.now();
  const env = context.env ?? {};
  const meta: Record<string, any> = {
    hasAiGatewayKey: !!env.AI_GATEWAY_API_KEY,
    hasAiGatewayBase: !!env.AI_GATEWAY_BASE_URL,
    aiModel: env.AI_MODEL || "@makers/deepseek-v4-flash",
    hasContextStore: !!context?.store,
    hasContextRequest: !!context?.request,
    nodeVersion: typeof process !== "undefined" ? process.version : "unknown",
  };

  if (!env.AI_GATEWAY_API_KEY || !env.AI_GATEWAY_BASE_URL) {
    return new Response(JSON.stringify({
      ok: false,
      error: "AI_GATEWAY_API_KEY or AI_GATEWAY_BASE_URL not configured",
      meta,
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const body = context.request?.body ?? {};
  const message = (typeof body.message === "string" && body.message.trim())
    ? body.message.trim()
    : "Say 'hello world' to confirm you are working.";

  try {
    const model = new ChatOpenAI({
      model: env.AI_MODEL || "@makers/deepseek-v4-flash",
      apiKey: env.AI_GATEWAY_API_KEY!,
      configuration: {
        baseURL: env.AI_GATEWAY_BASE_URL!,
      },
      timeout: 60_000,
    });

    const response = await model.invoke([
      new SystemMessage("You are a test assistant. Reply with one short sentence to confirm you are working."),
      new HumanMessage(message),
    ]);

    const reply = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    meta.elapsedMs = Date.now() - startedAt;

    return new Response(JSON.stringify({
      ok: true,
      reply,
      meta,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    meta.elapsedMs = Date.now() - startedAt;
    return new Response(JSON.stringify({
      ok: false,
      error: e?.message || String(e),
      stack: e?.stack ? String(e.stack).split("\n").slice(0, 8).join("\n") : undefined,
      meta,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
