"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { marked } from "marked";
import { OrderCard } from "./cards/order-card";
import { RefundCard } from "./cards/refund-card";
import { ExchangeCard } from "./cards/exchange-card";
import { FaqCard } from "./cards/faq-card";
import { useT } from "../../lib/i18n";

marked.setOptions({ gfm: true, breaks: true });

// ============ Types ============

interface CardData {
  type: string;
  data: any;
}

interface SuggestAction {
  id: string;
  emoji: string;
  title: string;
  action?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: CardData[];
  step?: string;
  suggestions?: SuggestAction[];
}

function MarkdownBlock({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ============ Component ============

export function ChatPanel() {
  const { t, locale } = useT();

  // Initial welcome message — recompute when locale changes
  const initialMessage = useMemo<Message>(() => ({
    role: "assistant",
    content: t("ui.chat.welcome"),
    suggestions: [
      { id: "faq", emoji: "📋", title: t("sug.faqPolicy") },
      { id: "order", emoji: "🔍", title: t("sug.lookupOrder") },
      { id: "refund", emoji: "💰", title: t("sug.refund") },
      { id: "exchange", emoji: "🔄", title: t("sug.exchange") },
    ],
  }), [t]);

  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [pendingAction, setPendingAction] = useState<{ intent: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const conversationId = useMemo(() => {
    const KEY = "after-sales-conversation-id";
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }, []);

  // When locale changes, refresh ONLY the initial welcome message (preserve conversation history)
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 0) return [initialMessage];
      const isOnlyWelcome = prev.length === 1 && prev[0].role === "assistant";
      if (isOnlyWelcome) return [initialMessage];
      return prev;
    });
  }, [initialMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStep]);

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage = content.trim();
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);
    setCurrentStep(t("ui.chat.processing"));

    setMessages(prev => [...prev, { role: "assistant", content: "", cards: [] }]);

    abortControllerRef.current = new AbortController();
    const currentPendingAction = pendingAction;
    setPendingAction(null);

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({
          message: userMessage,
          locale,
          ...(currentPendingAction ? { pendingAction: currentPendingAction } : {}),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        let errMsg = t("ui.chat.errorRequest", { status: response.status });
        try {
          const errBody = await response.text();
          if (response.status === 429 || errBody.includes("quota")) {
            errMsg = t("ui.chat.errorQuota");
          } else if (errBody) {
            errMsg = errBody.slice(0, 200);
          }
        } catch {}
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      const cards: CardData[] = [];
      let suggestions: SuggestAction[] = [];
      let lastCardType = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;

          try {
            const event = JSON.parse(payload);

            switch (event.type) {
              case "workflow_step":
                setCurrentStep(event.label || event.step);
                break;
              case "ai_response":
                assistantContent = event.content;
                setMessages(prev => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last.role === "assistant") {
                    last.content = assistantContent;
                    last.cards = [...cards];
                  }
                  return copy;
                });
                break;
              case "card":
                lastCardType = event.cardType;
                cards.push({ type: event.cardType, data: event.data });
                setMessages(prev => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last.role === "assistant") last.cards = [...cards];
                  return copy;
                });
                break;
              case "suggest_actions":
                if (Array.isArray(event.actions)) {
                  suggestions = event.actions;
                }
                break;
              case "pending_action":
                if (event.intent) {
                  setPendingAction({ intent: event.intent });
                }
                break;
              case "status":
                if (event.status === "complete" && suggestions.length === 0) {
                  suggestions = generateFollowUpSuggestions(lastCardType, assistantContent, t, locale);
                }
                break;
              case "ping":
                break;
            }
          } catch {}
        }
      }

      if (suggestions.length > 0) {
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last.role === "assistant") last.suggestions = suggestions;
          return copy;
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last.role === "assistant" && !last.content) copy.pop();
          return copy;
        });
      } else {
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last.role === "assistant") last.content = `${t("ui.chat.errorPrefix")}${(e as Error).message}`;
          return copy;
        });
      }
    } finally {
      setIsLoading(false);
      setCurrentStep("");
      abortControllerRef.current = null;
    }
  }, [conversationId, isLoading, locale, t, pendingAction]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    fetch("/stop", {
      method: "POST",
      // NOTE: do NOT send makers-conversation-id header here — it would
      // sticky-route /stop to the busy chat instance and abort would never fire.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }, [conversationId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const msg = input.trim();
    setInput("");
    handleSend(msg);
  };

  const renderCard = (card: CardData, idx: number) => {
    switch (card.type) {
      case "order_detail": return <OrderCard key={idx} order={card.data.order} />;
      case "refund_progress": return <RefundCard key={idx} order={card.data.order} />;
      case "exchange_confirm": return <ExchangeCard key={idx} order={card.data.order} />;
      case "faq_sources": return <FaqCard key={idx} sources={card.data.sources} />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role !== "user" && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mr-2.5 mt-0.5 shadow-sm">AI</div>
            )}
            <div className={`max-w-[75%] ${msg.role === "user"
              ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm"
              : "space-y-2.5"
            }`}>
              {msg.role === "user" ? (
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              ) : (
                <>
                  {msg.content ? (
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-gray-100/80">
                      <div className="text-[13px] prose-chat max-w-none text-gray-700 leading-relaxed">
                        <MarkdownBlock content={msg.content} />
                      </div>
                    </div>
                  ) : (
                    isLoading && i === messages.length - 1 && (
                      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-gray-100/80">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-[12px] text-gray-400">{currentStep}</span>
                        </div>
                      </div>
                    )
                  )}
                  {msg.cards?.map((card, idx) => renderCard(card, idx))}
                  {msg.suggestions && msg.suggestions.length > 0 && !isLoading && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.suggestions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleSend(s.action || s.title)}
                          disabled={isLoading}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-white text-gray-600 border border-gray-200 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all shadow-sm disabled:opacity-50"
                        >
                          <span className="mr-1">{s.emoji}</span>{s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 bg-white border-t border-gray-100 px-5 py-3">
        <div className="flex gap-2.5 items-end max-w-2xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              placeholder={t("ui.chat.placeholder")}
              disabled={isLoading}
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-200 pl-4 pr-4 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 disabled:opacity-50 bg-gray-50/50 placeholder:text-gray-400 transition-all"
            />
          </div>
          {isLoading ? (
            <button
              type="button"
              onClick={handleStop}
              className="h-9 w-9 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors flex-shrink-0 shadow-sm"
            >
              <span className="w-2.5 h-2.5 bg-white rounded-[2px]" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-30 flex-shrink-0 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ============ Smart Follow-up Suggestions (fallback when backend doesn't supply) ============

function generateFollowUpSuggestions(
  lastCardType: string,
  content: string,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string
): SuggestAction[] {
  switch (lastCardType) {
    case "order_detail":
      return [
        { id: "refund", emoji: "💰", title: t("sug.refund") },
        { id: "exchange", emoji: "🔄", title: t("sug.exchange") },
      ];
    case "refund_progress":
      return [
        { id: "status", emoji: "📦", title: t("sug.timelineRefund") },
        { id: "other_order", emoji: "🔍", title: t("sug.lookupOther") },
      ];
    case "exchange_confirm":
      return [
        { id: "logistics", emoji: "🚚", title: t("sug.address") },
        { id: "timeline", emoji: "⏰", title: t("sug.timelineExchange") },
      ];
    case "faq_sources":
      return [
        { id: "order", emoji: "🔍", title: t("sug.lookupMyOrders") },
        { id: "refund", emoji: "💰", title: t("sug.refundApply") },
      ];
    default:
      // Bilingual keyword scan as a rough fallback
      const c = content.toLowerCase();
      if (content.includes("退款") || content.includes("退货") || c.includes("refund")) {
        return [
          { id: "faq", emoji: "📋", title: t("sug.faqGeneral") },
          { id: "order", emoji: "🔍", title: t("sug.lookupMyOrders") },
        ];
      }
      return [
        { id: "faq", emoji: "📋", title: t("sug.faqGeneral") },
        { id: "order", emoji: "🔍", title: t("sug.lookupMyOrders") },
        { id: "refund", emoji: "💰", title: t("sug.refundApply") },
      ];
  }
}
