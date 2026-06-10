"use client";

/**
 * Frontend i18n module — React Context + useT() hook.
 *
 * Storage: localStorage key "aftersales-locale"
 * Default: "en" (default-first experience is English; users can switch
 * to Chinese via the lang toggle, and the choice persists in localStorage)
 *
 * Backend has a parallel module at agents/_i18n.ts with overlapping keys.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "zh" | "en";

const STORAGE_KEY = "aftersales-locale";

// ─── Translation tables ───

const ZH: Record<string, string> = {
  // Header / page chrome
  "ui.header.title": "售后客服助手",
  "ui.header.subtitle": "订单查询 · 退货退款 · 换货 · 政策咨询",
  "ui.header.kb": "知识库",
  "ui.header.online": "在线",
  "ui.header.langSwitch": "EN",
  "ui.warn.envMissing": "环境变量未配置，部分功能不可用。",
  "ui.warn.missing": "缺少：{names}",

  // Chat panel
  "ui.chat.welcome": "您好！我是售后客服助手，有什么可以帮您？\n\n如果是首次使用，请先打开右上角「知识库」一键导入演示数据。",
  "ui.chat.placeholder": "描述您的问题，或输入订单号查询...",
  "ui.chat.send": "发送",
  "ui.chat.processing": "正在处理...",
  "ui.chat.errorPrefix": "出错了：",
  "ui.chat.errorRequest": "请求失败 ({status})",
  "ui.chat.errorQuota": "⚠️ AI 模型调用额度已用尽，请稍后再试或升级套餐。",

  // Suggestions in welcome screen
  "sug.faqPolicy": "退货政策是什么？",
  "sug.lookupOrder": "查询订单状态",
  "sug.refund": "我要退款",
  "sug.exchange": "我要换货",
  "sug.refundApply": "我要申请退款",

  // Manage panel
  "ui.manage.title": "知识库",
  "ui.manage.tabAll": "全部",
  "ui.manage.cat.faq": "FAQ",
  "ui.manage.cat.policy": "政策",
  "ui.manage.cat.product": "产品",
  "ui.manage.cat.order_doc": "订单",
  "ui.manage.btn.upload": "上传文件",
  "ui.manage.btn.addManual": "+ 手动录入",
  "ui.manage.btn.importDemo": "🚀 导入 Demo",
  "ui.manage.demo.preparing": "正在准备导入...",
  "ui.manage.empty.title": "暂无文档",
  "ui.manage.empty.hint": "点击右上角「🚀 导入 Demo」快速体验",
  "ui.manage.form.titleOrderPlaceholder": "订单号（按 Tab 填入完整示例）",
  "ui.manage.form.titlePlaceholder": "文档标题",
  "ui.manage.form.orderHelper": "录入订单信息，AI 将根据此信息回答用户的售后问题",
  "ui.manage.form.orderPlaceholder": "按 Tab 填入示例，或手动输入：\n商品：智能手表 Ultra\n规格：钛金属 / 49mm\n数量：1\n金额：¥3999\n状态：已签收\n下单时间：2025-05-18\n快递：圆通快递 YT9876543210\n备注：用户要求开发票",
  "ui.manage.form.contentPlaceholder": "文档内容（支持多段落）...",
  "ui.manage.form.cancel": "取消",
  "ui.manage.form.save": "保存",
  "ui.manage.form.confirmDelete": "确定删除此文档？",
  "ui.manage.viewDoc": "查看原文",
  "ui.manage.label.order": "订单",
  "ui.manage.unitChars": "{n}字",

  // Status labels (also exists in backend, but frontend renders client-side too)
  "status.pending": "待发货",
  "status.shipped": "运输中",
  "status.delivered": "已签收",
  "status.refund_requested": "退款申请中",
  "status.refund_approved": "退款已批准",
  "status.refund_completed": "退款已完成",
  "status.exchange_requested": "换货申请中",
  "status.exchange_shipped": "换货已寄出",

  // Cards
  "ui.card.order.total": "合计",
  "ui.card.order.shipping": "物流",
  "ui.card.order.placedAt": "下单时间",
  "ui.card.refund.title": "退款进度",
  "ui.card.refund.orderId": "订单号",
  "ui.card.refund.product": "商品",
  "ui.card.refund.amount": "退款金额",
  "ui.card.refund.reason": "原因",
  "ui.card.refund.step.submit": "提交申请",
  "ui.card.refund.step.review": "审核中",
  "ui.card.refund.step.complete": "退款到账",
  "ui.card.exchange.title": "换货申请",
  "ui.card.exchange.orderId": "订单号",
  "ui.card.exchange.product": "商品",
  "ui.card.exchange.status": "状态",
  "ui.card.exchange.shipped": "新件已寄出",
  "ui.card.exchange.pending": "等待审核",
  "ui.card.exchange.notesTitle": "换货须知：",
  "ui.card.exchange.note1": "请保持商品全新状态",
  "ui.card.exchange.note2": "附带完整包装和配件",
  "ui.card.exchange.note3": "收到旧件后 3 个工作日内寄出新件",
  "ui.card.faq.title": "📚 参考文档",
};

const EN: Record<string, string> = {
  // Header / page chrome
  "ui.header.title": "After-Sales Assistant",
  "ui.header.subtitle": "Order lookup · Refund · Exchange · Policy",
  "ui.header.kb": "Knowledge Base",
  "ui.header.online": "Online",
  "ui.header.langSwitch": "中",
  "ui.warn.envMissing": "Environment variables not configured. Some features unavailable.",
  "ui.warn.missing": "Missing: {names}",

  // Chat panel
  "ui.chat.welcome": "Hello! I'm the after-sales assistant. How can I help?\n\nFirst time? Open the Knowledge Base on the top-right and import the demo data.",
  "ui.chat.placeholder": "Describe your issue or enter an order ID...",
  "ui.chat.send": "Send",
  "ui.chat.processing": "Processing...",
  "ui.chat.errorPrefix": "Error: ",
  "ui.chat.errorRequest": "Request failed ({status})",
  "ui.chat.errorQuota": "⚠️ AI quota exhausted. Please try again later or upgrade your plan.",

  // Suggestions
  "sug.faqPolicy": "What's the return policy?",
  "sug.lookupOrder": "Check order status",
  "sug.refund": "I want a refund",
  "sug.exchange": "I want to exchange",
  "sug.refundApply": "Apply for a refund",

  // Manage panel
  "ui.manage.title": "Knowledge Base",
  "ui.manage.tabAll": "All",
  "ui.manage.cat.faq": "FAQ",
  "ui.manage.cat.policy": "Policy",
  "ui.manage.cat.product": "Product",
  "ui.manage.cat.order_doc": "Order",
  "ui.manage.btn.upload": "Upload",
  "ui.manage.btn.addManual": "+ Add Text",
  "ui.manage.btn.importDemo": "🚀 Import Demo",
  "ui.manage.demo.preparing": "Preparing import...",
  "ui.manage.empty.title": "No documents yet",
  "ui.manage.empty.hint": "Click \"🚀 Import Demo\" on the top-right to get started",
  "ui.manage.form.titleOrderPlaceholder": "Order ID (press Tab to fill an example)",
  "ui.manage.form.titlePlaceholder": "Document title",
  "ui.manage.form.orderHelper": "Enter order info. AI will use it to answer customer questions.",
  "ui.manage.form.orderPlaceholder": "Press Tab to insert an example, or enter manually:\nProduct: Smart Watch Ultra\nSpecs: Titanium / 49mm\nQty: 1\nAmount: ¥3999\nStatus: Delivered\nOrdered: 2025-05-18\nShipping: YTO Express YT9876543210\nNote: customer requested invoice",
  "ui.manage.form.contentPlaceholder": "Document content (multi-paragraph supported)...",
  "ui.manage.form.cancel": "Cancel",
  "ui.manage.form.save": "Save",
  "ui.manage.form.confirmDelete": "Delete this document?",
  "ui.manage.viewDoc": "View Original",
  "ui.manage.label.order": "Order",
  "ui.manage.unitChars": "{n} chars",

  // Status
  "status.pending": "Pending",
  "status.shipped": "Shipped",
  "status.delivered": "Delivered",
  "status.refund_requested": "Refund Requested",
  "status.refund_approved": "Refund Approved",
  "status.refund_completed": "Refund Completed",
  "status.exchange_requested": "Exchange Requested",
  "status.exchange_shipped": "Exchange Shipped",

  // Cards
  "ui.card.order.total": "Total",
  "ui.card.order.shipping": "Shipping",
  "ui.card.order.placedAt": "Ordered",
  "ui.card.refund.title": "Refund Progress",
  "ui.card.refund.orderId": "Order ID",
  "ui.card.refund.product": "Product",
  "ui.card.refund.amount": "Amount",
  "ui.card.refund.reason": "Reason",
  "ui.card.refund.step.submit": "Submitted",
  "ui.card.refund.step.review": "In Review",
  "ui.card.refund.step.complete": "Refunded",
  "ui.card.exchange.title": "Exchange Request",
  "ui.card.exchange.orderId": "Order ID",
  "ui.card.exchange.product": "Product",
  "ui.card.exchange.status": "Status",
  "ui.card.exchange.shipped": "New item shipped",
  "ui.card.exchange.pending": "Awaiting review",
  "ui.card.exchange.notesTitle": "Exchange Notes:",
  "ui.card.exchange.note1": "Keep the item in pristine condition",
  "ui.card.exchange.note2": "Include original packaging and accessories",
  "ui.card.exchange.note3": "New item ships within 3 business days of receipt",
  "ui.card.faq.title": "📚 References",
};

const TABLES: Record<Locale, Record<string, string>> = { zh: ZH, en: EN };

// ─── Context ───

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Default to English for first-time visitors; the useEffect below hydrates
  // the user's stored choice from localStorage on mount.
  const [locale, setLocaleState] = useState<Locale>("en");
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage on mount (avoids SSR/hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (stored === "zh" || stored === "en") {
        setLocaleState(stored);
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Sync <html lang> attribute
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let str = TABLES[locale]?.[key] ?? TABLES.zh[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.split(`{${k}}`).join(String(v));
        }
      }
      return str;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  // Avoid rendering with wrong locale before hydration completes
  return (
    <I18nContext.Provider value={value}>
      <span style={{ display: "contents" }} suppressHydrationWarning>
        {hydrated ? children : children}
      </span>
    </I18nContext.Provider>
  );
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for components outside provider (shouldn't happen in practice).
    // Mirrors the default locale in I18nProvider.
    return {
      locale: "en",
      setLocale: () => {},
      t: (key, params) => {
        let str = EN[key] ?? ZH[key] ?? key;
        if (params) for (const [k, v] of Object.entries(params)) str = str.split(`{${k}}`).join(String(v));
        return str;
      },
    };
  }
  return ctx;
}
