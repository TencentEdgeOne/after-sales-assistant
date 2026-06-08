/**
 * Document Parser — extracts plain text from various file formats.
 *
 * Supported formats:
 * - Plain text: .txt, .md, .csv, .json, .tex, .ts, .js, .py, .go, .rs, .java
 * - PDF: .pdf (via unpdf)
 * - Word: .docx (via mammoth)
 * - Excel: .xlsx, .xls (via xlsx)
 * - PowerPoint: .pptx (basic XML extraction)
 * - Legacy Word: .doc (best-effort text extraction)
 */
import { createLogger } from "../agents/_shared";

const logger = createLogger("parser");

// Text-based extensions that need no special parsing
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "tex", "latex",
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "java",
  "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt",
  "yaml", "yml", "toml", "ini", "xml", "html", "css",
  "sh", "bash", "zsh", "sql", "r", "scala", "lua",
]);

/**
 * Parse a document and extract plain text.
 * Accepts either a string (for text files) or a Buffer/ArrayBuffer (for binary files).
 */
export async function parseDocument(
  input: string | Buffer | ArrayBuffer,
  filename: string
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Text-based files
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = typeof input === "string" ? input : bufferToString(input);
    return text;
  }

  // Binary format handlers
  const buffer = typeof input === "string" ? Buffer.from(input, "base64") : toBuffer(input);

  switch (ext) {
    case "pdf":
      return await parsePDF(buffer);
    case "docx":
      return await parseDOCX(buffer);
    case "doc":
      return await parseDOC(buffer);
    case "xlsx":
    case "xls":
      return await parseExcel(buffer);
    case "pptx":
      return await parsePPTX(buffer);
    case "ppt":
      return parsePPT(buffer);
    default:
      // Try as text
      const fallback = typeof input === "string" ? input : bufferToString(input);
      if (fallback && isPrintableText(fallback)) {
        return fallback;
      }
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

/**
 * Get list of all supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return [
    ...Array.from(TEXT_EXTENSIONS),
    "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt",
  ];
}

// ─── PDF Parser ───

async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // unpdf 期望 Uint8Array；Buffer 是其子类，但显式拷一份避免下游对底层 ArrayBuffer
    // 的偏移/长度断言失败（SCF 容器里见过 Buffer.subarray 的偏移把 PDF.js 搞挂）。
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text || "";
  } catch (e) {
    logger.error("PDF parse error:", (e as Error).message);
    throw new Error(`Failed to parse PDF: ${(e as Error).message}`);
  }
}

// ─── DOCX Parser ───

async function parseDOCX(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (e) {
    logger.error("DOCX parse error:", (e as Error).message);
    throw new Error(`Failed to parse DOCX: ${(e as Error).message}`);
  }
}

// ─── DOC Parser (legacy Word, best-effort) ───

function parseDOC(buffer: Buffer): string {
  try {
    const text = buffer.toString("utf-8");
    const segments: string[] = [];
    let current = "";

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 32 && code < 127 || code >= 0x4E00 && code <= 0x9FFF || code >= 0x3000 && code <= 0x303F) {
        current += text[i];
      } else if (current.length > 10) {
        segments.push(current);
        current = "";
      } else {
        current = "";
      }
    }
    if (current.length > 10) segments.push(current);

    const extracted = segments.join("\n");
    if (extracted.length < 50) {
      throw new Error("Could not extract meaningful text from .doc file");
    }
    return extracted;
  } catch (e) {
    throw new Error(`Failed to parse DOC: ${(e as Error).message}. Consider converting to .docx`);
  }
}

// ─── Excel Parser ───

async function parseExcel(buffer: Buffer): Promise<string> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const texts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      texts.push(`=== Sheet: ${sheetName} ===`);

      const csv = XLSX.utils.sheet_to_csv(sheet);
      texts.push(csv);
    }

    return texts.join("\n\n");
  } catch (e) {
    logger.error("Excel parse error:", (e as Error).message);
    throw new Error(`Failed to parse Excel: ${(e as Error).message}`);
  }
}

// ─── PPTX Parser ───

async function parsePPTX(buffer: Buffer): Promise<string> {
  try {
    const JSZip = await importJSZip();
    if (JSZip) {
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      let slideNum = 1;

      while (true) {
        const slideFile = zip.file(`ppt/slides/slide${slideNum}.xml`);
        if (!slideFile) break;

        const xml = await slideFile.async("text");
        const slideText = extractTextFromXML(xml);
        if (slideText.trim()) {
          texts.push(`--- Slide ${slideNum} ---\n${slideText}`);
        }
        slideNum++;
      }

      return texts.join("\n\n") || "No text content found in presentation";
    }

    return "PPTX parsing requires JSZip. Please convert to text format.";
  } catch (e) {
    logger.error("PPTX parse error:", (e as Error).message);
    throw new Error(`Failed to parse PPTX: ${(e as Error).message}`);
  }
}

function parsePPT(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  const segments: string[] = [];
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code < 127 || code >= 0x4E00 && code <= 0x9FFF) {
      current += text[i];
    } else if (current.length > 5) {
      segments.push(current);
      current = "";
    } else {
      current = "";
    }
  }
  if (current.length > 5) segments.push(current);

  const extracted = segments.filter(s => s.length > 10).join("\n");
  if (extracted.length < 50) {
    throw new Error("Could not extract text from .ppt file. Consider converting to .pptx");
  }
  return extracted;
}

// ─── Utilities ───

function bufferToString(input: Buffer | ArrayBuffer): string {
  if (input instanceof Buffer) return input.toString("utf-8");
  return Buffer.from(new Uint8Array(input)).toString("utf-8");
}

function toBuffer(input: Buffer | ArrayBuffer): Buffer {
  if (input instanceof Buffer) return input;
  return Buffer.from(new Uint8Array(input));
}

function isPrintableText(text: string): boolean {
  const sample = text.slice(0, 200);
  let printable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code >= 32 || code === 9 || code === 10 || code === 13) printable++;
  }
  return printable / sample.length > 0.8;
}

function extractTextFromXML(xml: string): string {
  const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
  if (!matches) return "";

  return matches
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function importJSZip(): Promise<any> {
  try {
    return (await import("jszip")).default;
  } catch {
    return null;
  }
}
