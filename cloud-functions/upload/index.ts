/**
 * Document Upload — handles document upload for the after-sales knowledge base.
 *
 * Accepts POST with:
 * - file (base64 content) + filename + category
 * - OR text + title + category (for inline text input)
 *
 * Streams progress via SSE: parsing → summarizing → saved.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLogger, createModel, sseEvent, createSSEResponse } from "../../agents/_shared";
import { saveDoc, findDocByFilename, removeDoc, type DocCategory } from "../../lib/doc-store";
import { parseDocument } from "../../lib/parser";

const logger = createLogger("upload");

const VALID_CATEGORIES: DocCategory[] = ["faq", "policy", "product", "order_doc"];

/**
 * Generate a summary and keywords for a document using AI Gateway.
 */
async function generateSummary(
  content: string,
  filename: string,
  category: string
): Promise<{ summary: string; keywords: string[] }> {
  const model = createModel();

  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n...[truncated]" : content;

  const response = await model.invoke([
    new SystemMessage(`你是一个文档摘要助手。给定一个文档，生成：
1. 简明摘要（200字以内），概述核心内容和用途。
2. 5-10个关键词，涵盖文档的主要主题。

文档分类：${category}

输出严格 JSON 格式（不含其他文本）：
{"summary": "...", "keywords": ["关键词1", "关键词2", ...]}`),
    new HumanMessage(`文件名: ${filename}\n\n文档内容:\n${truncated}`),
  ]);

  const text = typeof response.content === "string" ? response.content : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || text.slice(0, 400),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      };
    }
  } catch {}

  return {
    summary: text.slice(0, 400),
    keywords: [],
  };
}

export async function onRequest(context: any) {
  const { request } = context;
  const body = request?.body ?? {};
  const { file, filename, category, text, title } = body;

  // Get store (cloud-functions use context.agent?.store)
  const store = context.agent?.store ?? context.store ?? null;
  if (!store) {
    return new Response(JSON.stringify({
      error: "STORE_NOT_CONFIGURED",
      message: "Storage is not available. Deploy to EdgeOne Makers for automatic configuration.",
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  // Validate category
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Must have either file+filename or text+title
  const hasFile = file && filename;
  const hasText = text && title;
  if (!hasFile && !hasText) {
    return new Response(JSON.stringify({ error: "Missing required fields. Provide (file + filename) or (text + title)." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const docFilename = filename || title;
  const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function* streamUpload(): AsyncGenerator<string> {
    try {
      // Step 1: Parsing
      yield sseEvent({ type: "progress", stage: "parsing", message: `正在解析文档: ${docFilename}` });

      let extractedText: string;

      if (hasText) {
        extractedText = text;
      } else {
        extractedText = await parseDocument(Buffer.from(file, "base64"), filename);
      }

      if (!extractedText || extractedText.trim().length < 10) {
        yield sseEvent({ type: "error_message", content: "无法从文档中提取有效文本内容。" });
        return;
      }

      logger.log(`Extracted ${extractedText.length} chars from ${docFilename}`);
      yield sseEvent({ type: "progress", stage: "parsed", message: `解析完成，提取 ${extractedText.length} 字符` });

      // Step 2: Check for existing document (deduplication)
      const existing = await findDocByFilename(store, category, docFilename);
      const finalDocId = existing ? existing.docId : docId;
      if (existing) {
        logger.log(`Overwriting existing document: ${docFilename} (${existing.docId})`);
        await removeDoc(store, category, existing.docId);
      }

      // Step 3: Generate summary
      yield sseEvent({ type: "progress", stage: "summarizing", message: "正在生成摘要和关键词..." });

      const { summary, keywords } = await generateSummary(extractedText, docFilename, category);
      logger.log(`Summary generated for ${docFilename}: ${summary.slice(0, 60)}...`);

      // Step 4: Save to store
      yield sseEvent({ type: "progress", stage: "saving", message: "正在保存文档..." });

      await saveDoc(store, category, finalDocId, docFilename, extractedText, summary, keywords);

      // Step 5: Done
      yield sseEvent({
        type: "complete",
        data: {
          docId: finalDocId,
          filename: docFilename,
          category,
          summary,
          keywords,
          charCount: extractedText.length,
          overwritten: !!existing,
        },
      });
    } catch (e) {
      logger.error("Upload error:", (e as Error).message);
      yield sseEvent({ type: "error_message", content: `上传失败: ${(e as Error).message}` });
    }
  }

  return createSSEResponse(streamUpload(), request.signal);
}
