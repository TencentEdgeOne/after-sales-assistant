/**
 * Stop active run — abort the running generation for this conversation.
 *
 * IMPORTANT: the stop request MUST NOT carry the same `makers-conversation-id`
 * header as the chat request, otherwise EdgeOne sticky-routes /stop to the busy
 * chat instance and abortActiveRun() never reaches the runner. The target
 * conversation_id is therefore read from the request body, not the header.
 */
export async function onRequest(context: any) {
  // /stop endpoint: the frontend MUST pass conversation_id via the body
  // (carrying the `makers-conversation-id` header would sticky-route /stop to
  // the busy chat instance, and abortActiveRun would never reach the runner).
  // Body wins; runtime-injected context.conversation_id acts as a fallback.
  const body = (context.request?.body ?? {}) as Record<string, unknown>;
  const conversationId =
    (body.conversation_id as string | undefined) ??
    (body.conversationId as string | undefined) ??
    context.conversation_id;

  if (!conversationId) {
    return new Response(JSON.stringify({ error: "Missing conversation_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  }

  const result = context.utils.abortActiveRun(conversationId);

  return new Response(JSON.stringify({
    status: result.aborted ? "stopped" : "no_active_run",
    conversationId,
    ...result,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}
