import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { PageRecord } from "./types";

const execFileAsync = promisify(execFile);
const multiBlankline = /\n{3,}/g;
const trailingSpaces = /[ \t]+(?=\n)/g;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(trailingSpaces, "")
    .replace(multiBlankline, "\n\n")
    .replace(/\n+$/g, "");
}

function fallbackExtract(buffer: Buffer): PageRecord[] {
  const raw = buffer.toString("latin1");
  const chunks = raw
    .match(/\((?:\\.|[^\\)])*\)\s*Tj|\[(?:.|\n)*?\]\s*TJ/g)
    ?.map((part) =>
      part
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, " ")
        .replace(/\\([()\\])/g, "$1")
        .replace(/[()[\]]|Tj|TJ/g, " "),
    );
  const text = normalize((chunks ?? []).join(" ").replace(/\s+/g, " "));
  return [{ page_number: 1, text, char_count: text.length }];
}

export async function extractPages(filePath: string): Promise<PageRecord[]> {
  try {
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      "-enc",
      "UTF-8",
      filePath,
      "-",
    ]);
    const rawPages = stdout.split("\f").map(normalize).filter(Boolean);
    return rawPages.map((text, index) => ({
      page_number: index + 1,
      text,
      char_count: text.length,
    }));
  } catch {
    const buffer = await fs.readFile(filePath);
    return fallbackExtract(buffer);
  }
}
