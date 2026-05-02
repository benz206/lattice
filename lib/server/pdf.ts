import { execFile } from "node:child_process";
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

export async function extractPages(filePath: string): Promise<PageRecord[]> {
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", filePath, "-"],
    { maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` } },
  );
  const rawPages = stdout.split("\f").map(normalize).filter(Boolean);
  return rawPages.map((text, index) => ({
    page_number: index + 1,
    text,
    char_count: text.length,
  }));
}
