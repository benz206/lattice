"use client";

import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "math"; source: string }
  | { kind: "blockquote"; text: string }
  | { kind: "code"; code: string; language: string | null }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; rows: string[][] };

interface MarkdownPreviewProps {
  text: string;
  renderCitation?: (label: string, index: number, key: string) => ReactNode;
}

const FENCE_RE = /^```([\w-]+)?\s*$/;
const HEADING_RE = /^(#{1,4})\s+(.+)$/;
const UL_RE = /^\s*[-*+]\s+(.+)$/;
const OL_RE = /^\s*\d+[.)]\s+(.+)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.+)$/;
const CITATION_RE = /\[E(\d+)\]/g;
const INLINE_RE =
  /(\\\(.+?\\\)|\$[^$\n]+?\$|\[E\d+\]|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

const LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\text\{([^{}]+)\}/g, "$1"],
  [/\\mathrm\{([^{}]+)\}/g, "$1"],
  [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1⁄$2"],
  [/\\sqrt\{([^{}]+)\}/g, "√($1)"],
  [/\\left/g, ""],
  [/\\right/g, ""],
  [/\\cdot/g, "·"],
  [/\\times/g, "×"],
  [/\\leq/g, "≤"],
  [/\\geq/g, "≥"],
  [/\\neq/g, "≠"],
  [/\\approx/g, "≈"],
  [/\\sum/g, "Σ"],
  [/\\prod/g, "Π"],
  [/\\int/g, "∫"],
  [/\\infty/g, "∞"],
  [/\\alpha/g, "α"],
  [/\\beta/g, "β"],
  [/\\gamma/g, "γ"],
  [/\\delta/g, "δ"],
  [/\\theta/g, "θ"],
  [/\\lambda/g, "λ"],
  [/\\mu/g, "μ"],
  [/\\pi/g, "π"],
  [/\\sigma/g, "σ"],
  [/\\omega/g, "ω"],
];

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function latexToPreview(source: string): string {
  let preview = source.trim();
  for (const [pattern, value] of LATEX_REPLACEMENTS) {
    preview = preview.replace(pattern, value);
  }
  return preview
    .replace(/\^{([^{}]+)}/g, "^$1")
    .replace(/_{([^{}]+)}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/\s*=\s*/g, " = ")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s+/g, " ")
    .trim();
}

function readDisplayMath(lines: string[], start: number): { source: string; next: number } | null {
  const first = lines[start].trim();
  const open = first.startsWith("$$") ? "$$" : first.startsWith("\\[") ? "\\[" : null;
  if (!open) return null;
  const close = open === "$$" ? "$$" : "\\]";
  const sameLine = first.slice(open.length);
  const sameLineClose = sameLine.indexOf(close);
  if (sameLineClose !== -1) {
    return {
      source: sameLine.slice(0, sameLineClose).trim(),
      next: start + 1,
    };
  }

  const collected: string[] = [sameLine];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    const closeIndex = line.indexOf(close);
    if (closeIndex !== -1) {
      collected.push(line.slice(0, closeIndex));
      return { source: collected.join("\n").trim(), next: i + 1 };
    }
    collected.push(line);
    i += 1;
  }
  return { source: collected.join("\n").trim(), next: i };
}

function unwrapInlineMath(token: string): string | null {
  if (token.startsWith("\\(") && token.endsWith("\\)")) {
    return token.slice(2, -2);
  }
  if (token.startsWith("$") && token.endsWith("$")) {
    return token.slice(1, -1);
  }
  return null;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const language = fence[1] ?? null;
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", code: code.join("\n"), language });
      continue;
    }

    const displayMath = readDisplayMath(lines, i);
    if (displayMath) {
      blocks.push({ kind: "math", source: displayMath.source });
      i = displayMath.next;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: Math.min(4, Math.max(2, heading[1].length + 1)) as 2 | 3 | 4,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (
      i + 1 < lines.length &&
      line.includes("|") &&
      isTableDivider(lines[i + 1])
    ) {
      const rows = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const ul = line.match(UL_RE);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(UL_RE);
        if (!match) break;
        items.push(match[1].trim());
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    const ol = line.match(OL_RE);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(OL_RE);
        if (!match) break;
        items.push(match[1].trim());
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const quote = line.match(BLOCKQUOTE_RE);
    if (quote) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(BLOCKQUOTE_RE);
        if (!match) break;
        quoted.push(match[1].trim());
        i += 1;
      }
      blocks.push({ kind: "blockquote", text: quoted.join(" ") });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      if (
        FENCE_RE.test(lines[i]) ||
        readDisplayMath(lines, i) !== null ||
        HEADING_RE.test(lines[i]) ||
        UL_RE.test(lines[i]) ||
        OL_RE.test(lines[i]) ||
        BLOCKQUOTE_RE.test(lines[i])
      ) {
        break;
      }
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function renderInline(
  text: string,
  renderCitation?: MarkdownPreviewProps["renderCitation"],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > last) nodes.push(text.slice(last, start));

    const citation = token.match(CITATION_RE);
    if (citation) {
      const idx = Number.parseInt(citation[0].slice(2, -1), 10);
      nodes.push(renderCitation?.(token, idx, `${start}-${token}`) ?? token);
    } else {
      const math = unwrapInlineMath(token);
      if (math !== null) {
        nodes.push(
          <span key={`${start}-math`} className="math-inline">
            {latexToPreview(math)}
          </span>,
        );
      } else if (token.startsWith("`")) {
        nodes.push(
          <code key={`${start}-code`} className="rounded border border-line px-1 py-0.5">
            {token.slice(1, -1)}
          </code>,
        );
      } else if (token.startsWith("**") || token.startsWith("__")) {
        nodes.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith("*") || token.startsWith("_")) {
        nodes.push(<em key={`${start}-em`}>{token.slice(1, -1)}</em>);
      } else {
        const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        nodes.push(
          link ? (
            <a
              key={`${start}-link`}
              href={link[2]}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--accent)] underline-offset-2 hover:underline"
            >
              {link[1]}
            </a>
          ) : (
            token
          ),
        );
      }
    }
    last = start + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownPreview({
  text,
  renderCitation,
}: MarkdownPreviewProps): React.JSX.Element {
  const blocks = parseBlocks(text);

  return (
    <div className="markdown-preview mt-4 text-[15px] leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          const content = renderInline(block.text, renderCitation);
          if (block.level === 2) {
            return <h2 key={i}>{content}</h2>;
          }
          if (block.level === 3) {
            return <h3 key={i}>{content}</h3>;
          }
          return <h4 key={i}>{content}</h4>;
        }
        if (block.kind === "paragraph") {
          return <p key={i}>{renderInline(block.text, renderCitation)}</p>;
        }
        if (block.kind === "math") {
          return (
            <div key={i} className="math-display">
              {latexToPreview(block.source)}
            </div>
          );
        }
        if (block.kind === "blockquote") {
          return <blockquote key={i}>{renderInline(block.text, renderCitation)}</blockquote>;
        }
        if (block.kind === "code") {
          return (
            <pre key={i}>
              {block.language ? (
                <span className="mb-2 block text-[10px] uppercase tracking-wide text-muted">
                  {block.language}
                </span>
              ) : null}
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, renderCitation)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, renderCitation)}</li>
              ))}
            </ol>
          );
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => {
                      const Cell = rowIndex === 0 ? "th" : "td";
                      return (
                        <Cell key={cellIndex}>
                          {renderInline(cell, renderCitation)}
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
