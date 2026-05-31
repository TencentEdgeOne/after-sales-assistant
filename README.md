# After-Sales Assistant

AI-powered after-sales customer service agent with knowledge base retrieval (RAG), order management tools, and interactive UI cards. Built on [EdgeOne Pages](https://edgeone.ai) Agent platform with LangGraph.js state machine.

## Features

- **Intent-Based Routing** — LangGraph conditional edges route to: FAQ search / order lookup / refund / exchange / general chat
- **Multi-Category Knowledge Base** — FAQ, policies, product info, order docs with summary-based retrieval
- **AI-Powered UI Cards** — Order detail cards, refund progress, exchange confirmation rendered in chat
- **Document Management** — Upload files or manual entry, with LLM-generated summaries and keywords
- **One-Click Demo Import** — Seed 11 sample documents covering all categories
- **Order Operations** — Query status, request refund/exchange with state persistence
- **Multi-Turn Context** — langgraphStore preserves order context across requests
- **Stop Generation** — Frontend abort + backend abortActiveRun (dual mechanism)
- **SSE Streaming** — Real-time workflow step progress and results

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 16 + React 19 | App Router, Tailwind CSS |
| Agent Framework | LangGraph.js | StateGraph conditional routing |
| LLM | LangChain.js (`@langchain/openai`) | Via AI Gateway |
| Storage | `@edgeone/pages-blob` + langgraphStore | Knowledge base + workflow state |
| Platform | EdgeOne Pages | Cloud Functions, Memory API, Blob Storage |

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Set AI_GATEWAY_API_KEY, AI_GATEWAY_BASE_URL, PROJECT_ID, EDGEONE_PAGES_API_TOKEN

# Start development server
edgeone pages dev
```

## Architecture

```
User message → intent_recognition (LLM classification)
  ├── faq      → summary routing → load full docs → generate answer + FAQ card
  ├── lookup_order → query order → Order Detail card
  ├── refund   → validate + process → Refund Progress card
  ├── exchange → validate + process → Exchange Confirm card
  └── general  → general conversation
```

## SSE Event Types

```typescript
{ type: "workflow_step", step: "intent_recognition", label: "..." }
{ type: "ai_response", content: "..." }
{ type: "card", cardType: "order_detail", data: { order } }
{ type: "card", cardType: "refund_progress", data: { order } }
{ type: "card", cardType: "exchange_confirm", data: { order } }
{ type: "card", cardType: "faq_sources", data: { sources } }
```

## Project Structure

```
after-sales-assistant-edgeone/
├── agents/
│   ├── _shared.ts          # Model, SSE helpers, Order types & persistence
│   ├── _data/orders.ts     # Mock order data (auto-seeded)
│   ├── _data/faq.ts        # Legacy FAQ (replaced by knowledge base)
│   ├── _data/demo-docs.ts  # Demo documents for one-click import
│   ├── _graph/state.ts     # LangGraph state schema
│   ├── _graph/nodes.ts     # Node implementations (intent/faq/order/refund/exchange)
│   ├── _graph/edges.ts     # Conditional routing logic
│   ├── _graph/builder.ts   # Graph compilation
│   ├── chat.ts             # Main SSE chat handler
│   ├── stop.ts             # Abort active run
│   ├── upload.ts           # Document upload (file or text)
│   ├── manage.ts           # Document CRUD (list/get/delete/edit)
│   └── seed-demo.ts        # Batch import demo documents
├── lib/
│   ├── doc-store.ts        # Multi-category Blob document store
│   └── parser.ts           # File parser (PDF/DOCX/XLSX/TXT/MD)
├── app/
│   ├── page.tsx            # Main page (chat + knowledge base panel)
│   └── components/
│       ├── chat-panel.tsx       # Chat UI with SSE + cards
│       ├── manage-panel.tsx     # Knowledge base management sidebar
│       └── cards/
│           ├── order-card.tsx   # Order detail card
│           ├── refund-card.tsx  # Refund progress card
│           ├── exchange-card.tsx # Exchange confirmation card
│           └── faq-card.tsx     # FAQ source references card
├── edgeone.json
└── package.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway Base URL |
| `AI_MODEL` | No | Model name (default: `@makers/deepseek-v4-flash`) |
| `PROJECT_ID` | Yes | Pages project ID (for Blob storage) |
| `EDGEONE_PAGES_API_TOKEN` | Yes | API token (for Blob storage) |

## Deployment

```bash
edgeone pages deploy
```

## License

MIT
