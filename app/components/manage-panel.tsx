"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useT } from "../../lib/i18n";

interface DocItem {
  docId: string;
  category: string;
  filename: string;
  summary: string;
  keywords: string[];
  charCount: number;
  uploadedAt: string;
  // Optional fields for order_doc entries (parsed from content by backend)
  totalAmount?: number;
  carrier?: string;
  trackingNumber?: string;
  itemNames?: string;
  status?: string;
}

interface OrderItem {
  productId: string;
  name: string;
  specs: string;
  quantity: number;
  price: number;
}

interface OrderRecord {
  orderId: string;
  userId: string;
  items: OrderItem[];
  totalAmount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  trackingNumber?: string;
  carrier?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600",
  shipped: "bg-blue-50 text-blue-600",
  delivered: "bg-green-50 text-green-600",
  refund_requested: "bg-rose-50 text-rose-600",
  refund_approved: "bg-rose-50 text-rose-600",
  refund_completed: "bg-rose-50 text-rose-600",
  exchange_requested: "bg-purple-50 text-purple-600",
  exchange_shipped: "bg-purple-50 text-purple-600",
};

// Order ID pattern (e.g. ORD-20250520-001)
const ORDER_FILENAME_RE = /^ORD-\d{8}-\d{3,}/i;

/** Detect order status from free-text — bilingual keywords. */
function detectStatusFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (text.includes("换货申请") || lower.includes("exchange_requested") || lower.includes("exchange request")) return "exchange_requested";
  if (text.includes("退款申请") || text.includes("退款中") || lower.includes("refund_requested") || lower.includes("refund request")) return "refund_requested";
  if (text.includes("已签收") || text.includes("已收货") || text.includes("签收") || lower.includes("delivered")) return "delivered";
  if (text.includes("运输中") || text.includes("已发货") || text.includes("在途") || lower.includes("shipped") || lower.includes("in transit")) return "shipped";
  if (text.includes("待发货") || text.includes("未发货") || lower.includes("pending")) return "pending";
  return null;
}

// Order example data for Tab autocomplete — bilingual sets
const ORDER_EXAMPLES_ZH = [
  {
    id: "ORD-20250520-001",
    content: `商品：无线降噪耳机 Pro\n规格：黑色 / 标准版\n数量：1\n金额：¥1299\n状态：已签收\n下单时间：2025-05-20\n签收时间：2025-05-22\n快递：顺丰速运 SF1234567890\n备注：用户已确认收货`,
  },
  {
    id: "ORD-20250518-002",
    content: `商品：智能手表 Ultra\n规格：钛金属 / 49mm\n数量：1\n金额：¥3999\n状态：运输中\n下单时间：2025-05-18\n快递：圆通快递 YT9876543210\n预计到达：2025-05-23\n备注：用户询问物流进度`,
  },
  {
    id: "ORD-20250515-003",
    content: `商品：便携蓝牙音箱\n规格：星空蓝 / 标准版\n数量：2\n金额：¥598\n状态：已签收\n下单时间：2025-05-15\n签收时间：2025-05-17\n快递：韵达快递 YD1122334455\n备注：用户反映音质问题，申请换货`,
  },
  {
    id: "ORD-20250510-004",
    content: `商品：机械键盘 87键\n规格：茶轴 / 黑色\n数量：1\n金额：¥499\n状态：待发货\n下单时间：2025-05-10\n预计发货：2025-05-25\n备注：库存紧张，等待补货`,
  },
];

const ORDER_EXAMPLES_EN = [
  {
    id: "ORD-20250520-001",
    content: `Product: Wireless Noise-Cancelling Headphones Pro\nSpecs: Black / Standard\nQty: 1\nAmount: ¥1299\nStatus: Delivered\nOrdered: 2025-05-20\nDelivered: 2025-05-22\nShipping: SF Express SF1234567890\nNote: Customer confirmed receipt`,
  },
  {
    id: "ORD-20250518-002",
    content: `Product: Smart Watch Ultra\nSpecs: Titanium / 49mm\nQty: 1\nAmount: ¥3999\nStatus: Shipped\nOrdered: 2025-05-18\nShipping: YTO Express YT9876543210\nETA: 2025-05-23\nNote: Customer asking about delivery progress`,
  },
  {
    id: "ORD-20250515-003",
    content: `Product: Portable Bluetooth Speaker\nSpecs: Starry Blue / Standard\nQty: 2\nAmount: ¥598\nStatus: Delivered\nOrdered: 2025-05-15\nDelivered: 2025-05-17\nShipping: Yunda Express YD1122334455\nNote: Customer reports sound quality issue, requesting exchange`,
  },
  {
    id: "ORD-20250510-004",
    content: `Product: Mechanical Keyboard 87-key\nSpecs: Brown Switch / Black\nQty: 1\nAmount: ¥499\nStatus: Pending\nOrdered: 2025-05-10\nETA Shipping: 2025-05-25\nNote: Stock low, awaiting restock`,
  },
];

export function ManagePanel({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();

  // Localized categories (recompute on locale change)
  const CATEGORIES = useMemo(() => [
    { value: "faq", label: t("ui.manage.cat.faq"), icon: "💬", color: "blue" },
    { value: "policy", label: t("ui.manage.cat.policy"), icon: "📋", color: "amber" },
    { value: "product", label: t("ui.manage.cat.product"), icon: "📦", color: "emerald" },
    { value: "order_doc", label: t("ui.manage.cat.order_doc"), icon: "🧾", color: "purple" },
  ], [t]);

  const ORDER_EXAMPLES = locale === "en" ? ORDER_EXAMPLES_EN : ORDER_EXAMPLES_ZH;

  const [docs, setDocs] = useState<DocItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [uploadProgress, setUploadProgress] = useState("");
  const [demoProgress, setDemoProgress] = useState("");
  const [demoCurrentDoc, setDemoCurrentDoc] = useState<{ title: string; category: string } | null>(null);
  const [demoImportedCount, setDemoImportedCount] = useState(0);
  const [demoTotal, setDemoTotal] = useState(0);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState("faq");
  const [viewingDoc, setViewingDoc] = useState<{ docId: string; category: string; filename: string; content: string } | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [storeUnavailable, setStoreUnavailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabCycleRef = useRef(0);
  const loadDocsAbortRef = useRef<AbortController | null>(null);
  // /seed-demo and /upload are now agent endpoints — they require makers-conversation-id header.
  // /manage is still a cloud-function so it doesn't need this header (and we keep it unchanged).
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

  const loadDocs = useCallback(async () => {
    loadDocsAbortRef.current?.abort();
    const ac = new AbortController();
    loadDocsAbortRef.current = ac;

    setIsLoading(true);
    try {
      const body: any = { action: "list", locale };
      if (activeCategory !== "all") body.category = activeCategory;
      const res = await fetch("/manage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (res.status === 503) {
        setStoreUnavailable(true);
        setDocs([]);
      } else if (res.ok) {
        setStoreUnavailable(false);
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      if (!ac.signal.aborted) setIsLoading(false);
    }
  }, [activeCategory, locale]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const loadOrdersList = useCallback(async () => {
    try {
      const res = await fetch("/manage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({ action: "list_orders", locale }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.orders)) {
          setOrders(data.orders as OrderRecord[]);
        }
      }
    } catch {}
  }, [locale]);

  useEffect(() => { loadOrdersList(); }, [loadOrdersList]);

  const handleViewDoc = async (docId: string, category: string, filename: string) => {
    setLoadingContent(true);
    try {
      const res = await fetch("/manage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({ action: "get", docId, category, locale }),
      });
      if (res.ok) {
        const data = await res.json();
        setViewingDoc({ docId, category, filename, content: data.content || "" });
      }
    } catch {} finally { setLoadingContent(false); }
  };

  const handleDelete = async (docId: string, category: string) => {
    if (!confirm(t("ui.manage.form.confirmDelete"))) return;
    try {
      await fetch("/manage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({ action: "delete", docId, category, locale }),
      });
      setDocs(prev => prev.filter(d => d.docId !== docId));
    } catch {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress(t("upload.parsing", { filename: file.name }));
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const uploadCategory = activeCategory !== "all" ? activeCategory : formCategory;
      try {
        const res = await fetch("/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "makers-conversation-id": conversationId,
          },
          body: JSON.stringify({ file: base64, filename: file.name, category: uploadCategory, locale }),
        });
        if (!res.ok) throw new Error("Upload failed");
        const reader2 = res.body?.getReader();
        if (reader2) {
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader2.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "progress") setUploadProgress(ev.message);
                if (ev.type === "complete") { setUploadProgress(""); loadDocs(); }
              } catch {}
            }
          }
        }
      } catch (err) {
        setUploadProgress(t("upload.failure", { error: (err as Error).message }));
        setTimeout(() => setUploadProgress(""), 3000);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleAddText = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    setUploadProgress(t("upload.saving"));
    try {
      const res = await fetch("/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({ text: formContent, title: formTitle, category: formCategory, locale }),
      });
      if (!res.ok) throw new Error("Save failed");
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "progress") setUploadProgress(ev.message);
              if (ev.type === "complete") {
                setUploadProgress("");
                setShowAddForm(false);
                setFormTitle("");
                setFormContent("");
                loadDocs();
                loadOrdersList();
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setUploadProgress(t("upload.failure", { error: (err as Error).message }));
      setTimeout(() => setUploadProgress(""), 3000);
    }
  };

  const handleSeedDemo = async () => {
    setDemoProgress(t("ui.manage.demo.preparing"));
    setDemoCurrentDoc(null);
    setDemoImportedCount(0);
    setDemoTotal(0);
    try {
      const res = await fetch("/seed-demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "makers-conversation-id": conversationId,
        },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) throw new Error("Seed failed");
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            if (line.slice(6).trim() === "[DONE]") break;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "progress") {
                setDemoProgress(ev.message);
                if (ev.total) setDemoTotal(ev.total);
              }
              if (ev.type === "doc_imported" || ev.type === "order_imported") {
                setDemoCurrentDoc({ title: ev.title, category: ev.category || "order_doc" });
                setDemoImportedCount(c => c + 1);
              }
              if (ev.type === "complete") {
                setDemoProgress("");
                setDemoCurrentDoc(null);
                setDemoImportedCount(0);
                setDemoTotal(0);
                loadDocs();
                loadOrdersList();
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setDemoProgress(t("upload.failure", { error: (err as Error).message }));
      setTimeout(() => { setDemoProgress(""); setDemoCurrentDoc(null); }, 3000);
    }
  };

  const catMeta = (cat: string) => CATEGORIES.find(c => c.value === cat);
  const statusLabelOf = (s: string) => t(`status.${s}`);
  const orderTagLabel = t("ui.manage.label.order");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <span className="text-[13px] font-semibold text-gray-800">{t("ui.manage.title")}</span>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none">&times;</button>
      </div>

      {/* Category filter */}
      <div className="px-3 py-2 flex gap-1.5 border-b border-gray-50 flex-shrink-0">
        <button
          onClick={() => setActiveCategory("all")}
          className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-all ${
            activeCategory === "all" ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
          }`}
        >{t("ui.manage.tabAll")}</button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-all ${
              activeCategory === cat.value ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
            }`}
          >{cat.icon} {cat.label}</button>
        ))}
      </div>

      {/* Actions bar */}
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-gray-50 flex-shrink-0">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[11px] h-7 px-2.5 rounded-md bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors"
        >{t("ui.manage.btn.upload")}</button>
        <button
          onClick={() => {
            if (!showAddForm && activeCategory !== "all") {
              setFormCategory(activeCategory);
            }
            setShowAddForm(!showAddForm);
          }}
          className="text-[11px] h-7 px-2.5 rounded-md border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
        >{t("ui.manage.btn.addManual")}</button>
        <button
          onClick={handleSeedDemo}
          disabled={!!demoProgress}
          className="text-[11px] h-7 px-2.5 rounded-md bg-indigo-50 text-indigo-600 font-medium hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors ml-auto"
        >{t("ui.manage.btn.importDemo")}</button>
        <input ref={fileInputRef} type="file" className="hidden" accept=".txt,.md,.pdf,.docx,.doc,.xlsx,.xls,.csv,.json" onChange={handleFileUpload} />
      </div>

      {/* Demo import progress */}
      {(demoProgress || demoCurrentDoc) && (
        <div className="px-3 py-2.5 bg-indigo-50 border-b border-indigo-100 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-[11px] text-indigo-700 font-medium flex-1 truncate">{demoProgress}</span>
            {demoTotal > 0 && (
              <span className="text-[10px] text-indigo-400 flex-shrink-0">{demoImportedCount}/{demoTotal}</span>
            )}
          </div>
          {demoTotal > 0 && (
            <div className="h-1 bg-indigo-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${(demoImportedCount / demoTotal) * 100}%` }}
              />
            </div>
          )}
          {demoCurrentDoc && (
            <div className="flex items-center gap-2 py-1 px-2 bg-white rounded-md border border-indigo-100">
              <span className="text-[11px] flex-shrink-0">{CATEGORIES.find(c => c.value === demoCurrentDoc.category)?.icon || "📄"}</span>
              <span className="text-[11px] text-gray-700 truncate flex-1">{demoCurrentDoc.title}</span>
              <span className="text-[10px] text-indigo-400 flex-shrink-0">{CATEGORIES.find(c => c.value === demoCurrentDoc.category)?.label}</span>
            </div>
          )}
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress && (
        <div className="px-3 py-1.5 bg-indigo-50 flex items-center gap-2 flex-shrink-0">
          <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[11px] text-indigo-700">{uploadProgress}</span>
        </div>
      )}

      {/* Inline form */}
      {showAddForm && (
        <div className="px-3 py-3 border-b border-gray-100 bg-gray-50/50 space-y-2 flex-shrink-0">
          <div className="flex gap-2">
            <input
              value={formTitle}
              onChange={e => { setFormTitle(e.target.value); tabCycleRef.current = 0; }}
              onKeyDown={e => {
                if (e.key === "Tab" && formCategory === "order_doc") {
                  e.preventDefault();
                  const example = ORDER_EXAMPLES[tabCycleRef.current % ORDER_EXAMPLES.length];
                  tabCycleRef.current += 1;
                  setFormTitle(example.id);
                  setFormContent(example.content);
                }
              }}
              placeholder={formCategory === "order_doc" ? t("ui.manage.form.titleOrderPlaceholder") : t("ui.manage.form.titlePlaceholder")}
              className="flex-1 text-[12px] h-8 border border-gray-200 rounded-md px-3 bg-white focus:ring-1 focus:ring-indigo-300 outline-none"
            />
            <select
              value={formCategory}
              onChange={e => { setFormCategory(e.target.value); tabCycleRef.current = 0; setFormTitle(""); setFormContent(""); }}
              className="text-[11px] h-8 border border-gray-200 rounded-md px-2 bg-white text-gray-700 focus:ring-1 focus:ring-indigo-300 outline-none"
            >
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          {formCategory === "order_doc" ? (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-400">{t("ui.manage.form.orderHelper")}</p>
              <textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const example = ORDER_EXAMPLES[tabCycleRef.current % ORDER_EXAMPLES.length];
                    tabCycleRef.current += 1;
                    setFormTitle(example.id);
                    setFormContent(example.content);
                  }
                }}
                placeholder={t("ui.manage.form.orderPlaceholder")}
                rows={7}
                className="w-full text-[12px] border border-gray-200 rounded-md px-3 py-2 bg-white resize-none focus:ring-1 focus:ring-indigo-300 outline-none font-mono"
              />
            </div>
          ) : (
            <textarea
              value={formContent}
              onChange={e => setFormContent(e.target.value)}
              placeholder={t("ui.manage.form.contentPlaceholder")}
              rows={5}
              className="w-full text-[12px] border border-gray-200 rounded-md px-3 py-2 bg-white resize-none focus:ring-1 focus:ring-indigo-300 outline-none"
            />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)} className="text-[11px] h-7 px-3 rounded-md text-gray-500 hover:bg-gray-100">{t("ui.manage.form.cancel")}</button>
            <button
              onClick={handleAddText}
              disabled={!formTitle.trim() || !formContent.trim()}
              className="text-[11px] h-7 px-3 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >{t("ui.manage.form.save")}</button>
          </div>
        </div>
      )}

      {/* Document list */}
      <div className="flex-1 overflow-y-auto">
        {(() => {
          const showOrders = activeCategory === "all" || activeCategory === "order_doc";
          const visibleOrders = showOrders ? orders : [];
          const isEmpty = docs.length === 0 && visibleOrders.length === 0;
          const sep = locale === "en" ? ", " : "、";

          if (isLoading) {
            return (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            );
          }
          if (storeUnavailable) {
            return (
              <div className="text-center py-10 px-6">
                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl">⚠️</span>
                </div>
                <p className="text-[13px] text-amber-700 font-medium">{t("ui.manage.empty.unavailableTitle")}</p>
                <p className="text-[11px] text-gray-400 mt-1">{t("ui.manage.empty.unavailableHint")}</p>
              </div>
            );
          }
          if (isEmpty) {
            return (
              <div className="text-center py-10 px-6">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl opacity-50">📄</span>
                </div>
                <p className="text-[13px] text-gray-500 font-medium">{t("ui.manage.empty.title")}</p>
                <p className="text-[11px] text-gray-400 mt-1">{t("ui.manage.empty.hint")}</p>
              </div>
            );
          }
          return (
            <div className="divide-y divide-gray-50">
              {/* Real orders */}
              {visibleOrders.map(order => {
                const itemNames = order.items.map(i => i.name).join(sep);
                const sLabel = statusLabelOf(order.status);
                const sColor = STATUS_COLORS[order.status] || "bg-gray-100 text-gray-500";
                return (
                  <div key={`order-${order.orderId}`} className="group px-3 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-purple-50 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                        🧾
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-gray-900 truncate">{order.orderId}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${sColor}`}>
                            {sLabel}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 flex-shrink-0">{orderTagLabel}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{itemNames}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {order.carrier && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{order.carrier}</span>
                          )}
                          {order.trackingNumber && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 font-mono">{order.trackingNumber}</span>
                          )}
                          <span className="text-[10px] text-gray-300 ml-auto">¥{order.totalAmount}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Knowledge base docs */}
              {docs.map(doc => {
                const isOrderDoc = doc.category === "order_doc" && ORDER_FILENAME_RE.test(doc.filename);
                const detectedStatus = isOrderDoc
                  ? (doc.status || detectStatusFromText(`${doc.summary} ${(doc.keywords || []).join(" ")}`))
                  : null;
                const sLabel = detectedStatus ? statusLabelOf(detectedStatus) : null;
                const sColor = detectedStatus ? STATUS_COLORS[detectedStatus] : null;
                const description = isOrderDoc && doc.itemNames ? doc.itemNames : doc.summary;
                return (
                <div key={doc.docId} className="group px-3 py-3 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center text-sm flex-shrink-0 mt-0.5 ${isOrderDoc ? "bg-purple-50" : "bg-gray-100"}`}>
                      {isOrderDoc ? "🧾" : (catMeta(doc.category)?.icon || "📄")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-medium text-gray-900 truncate">{doc.filename}</span>
                        {sLabel && sColor && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${sColor}`}>
                            {sLabel}
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${isOrderDoc ? "bg-purple-50 text-purple-500" : "bg-gray-100 text-gray-500"}`}>
                          {catMeta(doc.category)?.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{description}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {isOrderDoc ? (
                          <>
                            {doc.carrier && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{doc.carrier}</span>
                            )}
                            {doc.trackingNumber && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 font-mono">{doc.trackingNumber}</span>
                            )}
                            {doc.totalAmount !== undefined ? (
                              <span className="text-[10px] text-gray-400 ml-auto">¥{doc.totalAmount}</span>
                            ) : (
                              <span className="text-[10px] text-gray-300 ml-auto">{t("ui.manage.unitChars", { n: doc.charCount })}</span>
                            )}
                          </>
                        ) : (
                          <>
                            {doc.keywords?.slice(0, 3).map(kw => (
                              <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{kw}</span>
                            ))}
                            <span className="text-[10px] text-gray-300 ml-auto">{t("ui.manage.unitChars", { n: doc.charCount })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleViewDoc(doc.docId, doc.category, doc.filename)}
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all flex-shrink-0"
                      title={t("ui.manage.viewDoc")}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(doc.docId, doc.category)}
                      className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Document Content Viewer */}
      {viewingDoc && (
        <div className="absolute inset-0 bg-white z-10 flex flex-col">
          <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setViewingDoc(null)} className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-[12px] font-medium text-gray-800 truncate">{viewingDoc.filename}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">
                {catMeta(viewingDoc.category)?.label}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loadingContent ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : (
              <pre className="text-[12px] text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{viewingDoc.content}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
