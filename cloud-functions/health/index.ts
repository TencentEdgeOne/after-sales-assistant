/**
 * Health check — returns configuration status for the frontend to display warnings.
 */
export async function onRequest(context: any) {
  const hasAiGateway = !!(process.env.AI_GATEWAY_API_KEY && process.env.AI_GATEWAY_BASE_URL);
  const store = context.agent?.store ?? context.store ?? null;
  const hasStore = !!store;

  const missing: string[] = [];
  if (!process.env.AI_GATEWAY_API_KEY) missing.push("AI_GATEWAY_API_KEY");
  if (!process.env.AI_GATEWAY_BASE_URL) missing.push("AI_GATEWAY_BASE_URL");

  return new Response(JSON.stringify({
    ok: hasAiGateway && hasStore,
    hasAiGateway,
    hasStore,
    missing,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
