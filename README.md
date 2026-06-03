# After-Sales Assistant

**Language:** English | [简体中文](./README_zh-CN.md)

AI-powered after-sales customer service agent with order management, knowledge-base retrieval, and interactive UI cards. Built on the LangGraph framework and deployed on EdgeOne Makers.

**Framework:** LangGraph · **Category:** Chat · **Language:** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.tencentcloud.com/edgeone/makers/new?template=after-sales-assistant&from=within&fromAgent=1&agentLang=typescript)

<!-- TODO: confirm -->
![preview](./assets/preview.png)

## Overview

This template provides an end-to-end after-sales assistant that handles refunds, exchanges, order lookups, and FAQ queries through a conversational interface. A LangGraph state machine routes user intents to specialized handlers, persists order state across multi-turn conversations, and renders rich UI cards for order details and refund progress.

- **Intent-Based Routing** — LangGraph conditional edges automatically classify requests into FAQ search, order lookup, refund, exchange, or general chat.
- **Order Lifecycle Management** — Query order status, process refunds, and request exchanges with full state persistence via the built-in store.
- **Knowledge-Base Retrieval** — Upload documents to a multi-category Blob store; the agent retrieves relevant sections to answer policy questions.
- **Interactive UI Cards** — The agent emits structured card events (order detail, refund progress, exchange confirmation, FAQ sources) that the frontend renders inline.
- **Multi-Turn Context** — Conversation state and order context are preserved across turns using `langgraphStore`, enabling follow-up questions like "What about my other order?"

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Model gateway API key. Use your Makers Models API Key, or any OpenAI-compatible provider key. |
| `AI_GATEWAY_BASE_URL` | Yes | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`. |
| `PROJECT_ID` | No | Pages project ID for Blob storage (knowledge base documents). |
| `EDGEONE_PAGES_API_TOKEN` | No | API token for Blob storage. |

This template follows the OpenAI-compatible standard — point these at Makers Models or any compatible provider.

### How to get AI_GATEWAY_API_KEY

1. Open the Makers Console (https://console.cloud.tencent.com/edgeone/makers)
2. Sign in and enable Makers
3. Go to Makers → Models → API Key and create a key
4. Copy it into `AI_GATEWAY_API_KEY`

> Built-in models are free within quota and great for validation. For production, bind your own paid provider key (BYOK).

## Local Development

**Prerequisites**
- Node.js 18+
- EdgeOne CLI (`npm i -g @edgeone/cli`)

```bash
npm install
# This project includes a .env file — update AI_GATEWAY_API_KEY and AI_GATEWAY_BASE_URL directly
edgeone makers dev
```

Open the local observability dashboard at http://localhost:8080/agent-metrics.

## Project Structure

```
after-sales-assistant-edgeone/
├── agents/
│   ├── _shared.ts          # Model init, SSE helpers, order types & persistence
│   ├── _data/              # Mock order data and demo documents
│   ├── _graph/
│   │   ├── builder.ts      # LangGraph state machine compilation
│   │   ├── edges.ts        # Intent routing logic
│   │   ├── nodes.ts        # Node implementations (intent, FAQ, order, refund, exchange)
│   │   └── state.ts        # Graph state schema
│   ├── chat/               # POST /chat — main SSE chat handler
│   └── stop/               # POST /stop — abort active run
├── cloud-functions/
│   ├── health/             # GET /health
│   ├── manage/             # POST /manage — document CRUD
│   ├── seed-demo/          # POST /seed-demo — batch import demo docs
│   └── upload/             # POST /upload — file or text upload
├── app/                    # Next.js App Router frontend
├── lib/
│   ├── doc-store.ts        # Multi-category Blob document store
│   └── parser.ts           # File parser (PDF/DOCX/XLSX/TXT/MD)
└── edgeone.json            # EdgeOne deployment config
```

Files prefixed with `_` are private modules — not exposed as public routes.

## How It Works

### Runtime Mode
Files under `agents/` run in **session mode**: requests with the same `conversation_id` are sticky-routed to the same agent instance. This means multi-turn conversations share the same memory context automatically.

### End-to-End Workflow

1. **Request entry** — The frontend POSTs `{ message, pendingAction }` to `/chat`.
2. **Intent recognition** — The LangGraph `intent_recognition` node classifies the user message into one of: `faq_search`, `lookup_order`, `request_refund`, `request_exchange`, or `general_chat`.
3. **Conditional routing** — The `routeByIntent` edge dispatches to the matching node.
4. **Tool / store execution** —
   - `lookup_order` queries `langgraphStore` for the order and emits an `order_detail` card.
   - `faq_search` retrieves documents from Blob storage and generates an answer with source references.
   - `request_refund` / `request_exchange` validate the order state, update status, and emit progress cards.
5. **State persistence** — After each turn, the graph state (current order, intent, waiting flags) is saved back to `langgraphStore` keyed by `conversation_id`.
6. **SSE response** — The handler streams workflow steps, AI text, card events, and smart follow-up suggestions to the frontend.
7. **Abort** — POST `/stop` with the conversation ID calls `context.utils.abortActiveRun` to cancel an in-flight generation.

### Key Routes & Parameters
- `/chat` — Main conversational endpoint. Accepts `message` and optional `pendingAction` in the request body.
- `/stop` — Cancel the active run for a conversation.
- `conversation_id` is provided automatically by the runtime via `context.conversation_id`.

### Timeouts
- `agents.timeout`: 900 seconds
- `agents.sandbox.timeout`: 900 seconds

## Resources

- [Makers Agents Documentation](https://edgeone.ai/makers)
- [Makers Quick Start](https://edgeone.ai/makers/docs/quickstart)
- [Makers Models](https://console.cloud.tencent.com/edgeone/makers/models)

## License

MIT
