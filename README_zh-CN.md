# 售后客服助手

基于 LangGraph 的售后客服 Agent，支持摘要路由 + 按需加载知识库，无需向量数据库。支持订单查询、退款/换货申请，内置知识库管理面板。部署在 EdgeOne Makers。

**Framework:** LangGraph · **Category:** Chat · **Language:** TypeScript

[![部署到 EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=after-sales-assistant&from=within&fromAgent=1&agentLang=typescript)

## 概述

本模板实现了一个状态机驱动的客服 Agent，能够识别用户意图、路由到专用处理器，并按需检索知识。无需向量数据库——FAQ 与产品知识通过摘要相似度匹配，仅在需要时加载完整内容。

- **意图识别** —— 将 incoming 消息分类为 FAQ、订单查询、退款、换货或通用聊天。
- **知识路由** —— 通过摘要相似度将用户查询匹配到最相关的知识库条目，然后按需加载完整内容。
- **订单工作流** —— 为订单查询、退款申请、换货申请提供专用处理器，支持结构化数据校验。
- **知识库管理面板** —— 单独的管理端点，用于添加、更新和整理 FAQ 条目与产品文档。
- **状态持久化** —— 工作流状态通过 `langgraphStore` 持久化，多轮交互跨请求存活。
- **双语界面** —— 完整中 / 英界面，AI 输出根据语言环境自动适配。

## 环境变量

| 变量 | 必填 | 说明 |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | 是 | 模型网关 API Key。使用 Makers Models 的 API Key，或任何兼容 OpenAI 协议的提供商 Key。 |
| `AI_GATEWAY_BASE_URL` | 是 | 网关基础地址。使用 Makers Models 时填写 `https://ai-gateway.edgeone.link/v1`。 |

本模板遵循 OpenAI 兼容标准 —— 可指向 Makers Models 或任何兼容提供商。

### 如何获取 AI_GATEWAY_API_KEY

1. 打开 Makers 控制台（https://edgeone.ai/makers/new?s_url=https://console.tencentcloud.com/edgeone/makers）
2. 登录并启用 Makers
3. 进入 Makers → Models → API Key，创建 Key
4. 将其填入 `AI_GATEWAY_API_KEY`

> 内置模型在额度内免费，适合验证；生产环境请绑定自费厂商 Key（BYOK）。

## 本地开发

**前置依赖**
- Node.js 18+
- EdgeOne CLI（`npm i -g edgeone`）

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 AI_GATEWAY_API_KEY 与 AI_GATEWAY_BASE_URL
edgeone makers dev
```

本地可观测面板地址：http://localhost:8088/agent-metrics。

## 项目结构

```
after-sales-assistant/
├── agents/
│   ├── chat/
│   │   └── index.ts        # POST /chat —— 主聊天（含意图路由）
│   ├── manage/
│   │   └── index.ts        # POST /manage —— 知识库管理
│   ├── upload/
│   │   └── index.ts        # POST /upload —— 文档上传
│   ├── stop/
│   │   └── index.ts        # POST /stop —— 中止运行
│   ├── seed-demo/
│   │   └── index.ts        # POST /seed-demo —— 初始化演示数据
│   ├── _graph/
│   │   ├── builder.ts      # LangGraph 状态机构建器
│   │   ├── state.ts        # 状态模式定义
│   │   ├── nodes.ts        # 意图处理节点
│   │   └── edges.ts        # 条件路由边
│   ├── _data/              # 演示知识库数据
│   ├── _i18n.ts            # 中 / 英翻译
│   └── _shared.ts          # 模型初始化、SSE 辅助函数、日志
├── cloud-functions/
│   └── health/             # GET /health
├── app/                    # Next.js App Router 前端
└── edgeone.json            # EdgeOne 部署配置
```

以 `_` 为前缀的文件是私有模块，不会作为公共路由暴露。

## 工作原理

### 运行模式
`agents/` 下的文件以**会话模式**运行：相同 `conversation_id` 的请求会被粘性路由到同一 Agent 实例。这保证了 LangGraph 状态与对话上下文在后续消息中始终可用。

### 端到端流程

1. **消息接收** —— 前端 POST `/chat`，携带用户消息与语言环境，通过 `makers-conversation-id` Header 传入。
2. **状态加载** —— 处理器从该对话的 `langgraphStore` 中加载先前保存的工作流状态。
3. **意图识别** —— LangGraph `intent_recognition` 节点将消息分类为：`faq_search`、`lookup_order`、`request_refund`、`request_exchange` 或 `general_chat`。
4. **条件路由** —— `routeByIntent` 边根据分类意图派发到对应的处理节点。
5. **节点执行**：
   - **faq_search** —— 将查询与知识库摘要匹配，加载最佳匹配的完整条目并返回答案。
   - **lookup_order** —— 查询订单数据并返回状态、商品与物流信息。
   - **request_refund** / **request_exchange** —— 引导用户完成退货/换货流程，进行结构化字段收集。
   - **general_chat** —— 直接用 LLM 处理开放式问题。
6. **状态保存** —— 更新的工作流状态被持久化回 `langgraphStore`。
7. **SSE 输出** —— 响应以 SSE 事件流回传，包括 `text_delta`、`tool_called` 和供前端渲染的 UI 卡片事件。

### 关键路由与参数
- `/chat` —— 主客服端点。Header：`makers-conversation-id: <uuid>`；Body：`{ message, locale? }`。
- `/manage` —— 知识库管理（增删改 FAQ 条目）。Body：`{ action, data }`。
- `/upload` —— 知识库文档上传。Body：`{ files[] }`。
- `/seed-demo` —— 初始化演示 FAQ 与订单数据（首次 setup 使用）。
- `/stop` —— 中止活跃运行。Body：`{ conversation_id }`。
- `/health` —— 存活探针（位于 `cloud-functions/`，不涉及 AI）。
- `conversation_id` 由前端生成，通过 `makers-conversation-id` Header 传入；运行时会自动绑定到 `context.conversation_id`。

### 超时配置
未自定义 Agent 超时，使用平台默认值。

## 相关资源

- [Makers Agents 文档](https://pages.edgeone.ai/document/agents) <!-- TODO: confirm slug -->
- [Makers 快速开始](https://pages.edgeone.ai/document/quickstart) <!-- TODO: confirm slug -->
- [Makers Models](https://pages.edgeone.ai/document/models) <!-- TODO: confirm slug -->

## 许可证

MIT
