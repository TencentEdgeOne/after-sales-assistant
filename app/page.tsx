"use client";

import { useState, useEffect } from "react";
import { ChatPanel } from "./components/chat-panel";
import { ManagePanel } from "./components/manage-panel";
import { useT } from "../lib/i18n";

interface HealthStatus {
  ok: boolean;
  hasAiGateway: boolean;
  hasStore: boolean;
  missing: string[];
}

export default function Home() {
  const { t, locale, setLocale } = useT();
  const [showManage, setShowManage] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/health")
      .then(r => r.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch(() => {});
  }, []);

  const showWarning = health && !health.ok;

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    const startedAt = Date.now();
    try {
      const res = await fetch("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ message: "Reply with: hello world" }),
      });
      const elapsed = Date.now() - startedAt;
      let body: any;
      let raw = "";
      try {
        body = await res.json();
      } catch {
        try { raw = await res.text(); } catch {}
      }
      const status = `HTTP ${res.status} (${elapsed}ms)`;
      const summary = body
        ? JSON.stringify(body, null, 2)
        : (raw ? raw.slice(0, 500) : "(empty body)");
      setTestResult(`${status}\n\n${summary}`);
    } catch (e: any) {
      setTestResult(`Network error: ${e?.message || String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="h-screen flex flex-col bg-[#f7f8fa]">
      {/* Test result modal */}
      {testResult !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setTestResult(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
              <span className="text-sm font-semibold text-gray-800">🧪 /test 接口结果</span>
              <button
                onClick={() => setTestResult(null)}
                className="w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none"
              >&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="text-[12px] text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{testResult}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Env config warning banner */}
      {showWarning && (
        <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2.5">
          <span className="text-amber-500 text-sm flex-shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            <span className="text-[12px] text-amber-800 font-medium">{t("ui.warn.envMissing")}</span>
            {!health.hasAiGateway && (health.missing?.length ?? 0) > 0 && (
              <span className="text-[11px] text-amber-600 ml-1.5">
                {t("ui.warn.missing", { names: (health.missing ?? []).join(locale === "en" ? ", " : "、") })}
              </span>
            )}
            {!health.hasStore && (
              <span className="text-[11px] text-amber-600 ml-1.5">
                {t("ui.warn.storeUnavailable")}
              </span>
            )}
          </div>
          <button
            onClick={() => setHealth(h => h ? { ...h, ok: true } : h)}
            className="flex-shrink-0 text-amber-400 hover:text-amber-600 text-sm leading-none"
          >✕</button>
        </div>
      )}

      {/* Header */}
      <header className="flex-shrink-0 h-14 bg-white border-b border-gray-200/80 px-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
            AI
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-gray-900 leading-tight">{t("ui.header.title")}</h1>
            <p className="text-[11px] text-gray-400 leading-tight">{t("ui.header.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="text-[11px] px-2.5 py-1 rounded-md border border-amber-200 text-amber-600 bg-amber-50/50 font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors"
            title="Call /test endpoint (minimal LLM ping, no graph / no SSE)"
          >
            {testing ? "Testing..." : "🧪 Test"}
          </button>
          <button
            onClick={() => setLocale(locale === "en" ? "zh" : "en")}
            className="text-[11px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
            title={locale === "en" ? "切换到中文" : "Switch to English"}
          >
            {t("ui.header.langSwitch")}
          </button>
          <button
            onClick={() => setShowManage(!showManage)}
            className={`text-xs px-3.5 py-1.5 rounded-lg font-medium transition-all ${
              showManage
                ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span className="mr-1">📚</span> {t("ui.header.kb")}
          </button>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            {t("ui.header.online")}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          <ChatPanel />
        </div>

        {showManage && (
          <aside className="w-[380px] flex-shrink-0 border-l border-gray-200/80 bg-white shadow-[-4px_0_12px_rgba(0,0,0,0.03)]">
            <ManagePanel onClose={() => setShowManage(false)} />
          </aside>
        )}
      </div>
    </main>
  );
}
