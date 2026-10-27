import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
]);
const TOKEN =
  /(\/\/.*$|\/\*[\s\S]*?\*\/|#[^\n]*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm;

function language(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension))
    return "code";
  if (extension === "json" || extension === "jsonc") return "json";
  if (extension === "css" || extension === "scss") return "css";
  if (extension === "html" || extension === "xml" || extension === "svg")
    return "html";
  if (extension === "md" || extension === "mdx") return "markdown";
  return "plain";
}

export function highlightedLine(line: string, kind: string): ReactNode[] {
  if (kind === "plain") return [line];
  if (kind === "markdown" && /^\s*#{1,6}\s/.test(line))
    return [
      <span className="pearl-token-keyword" key="heading">
        {line}
      </span>,
    ];
  const result: ReactNode[] = [];
  let offset = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index || 0;
    if (index > offset) result.push(line.slice(offset, index));
    const value = match[0];
    const token =
      value.startsWith("//") ||
      value.startsWith("/*") ||
      (kind === "markdown" && value.startsWith("#"))
        ? "comment"
        : /^["'`]/.test(value)
          ? "string"
          : /^\d/.test(value)
            ? "number"
            : KEYWORDS.has(value)
              ? "keyword"
              : kind === "html" &&
                  /^(?:html|head|body|div|span|script|style|main|section|a|p|h\d)$/.test(
                    value,
                  )
                ? "tag"
                : kind === "css" &&
                    line
                      .slice(index + value.length)
                      .trimStart()
                      .startsWith(":")
                  ? "property"
                  : kind === "json" &&
                      line
                        .slice(index + value.length)
                        .trimStart()
                        .startsWith(":")
                    ? "property"
                    : "";
    result.push(
      token ? (
        <span className={`pearl-token-${token}`} key={index}>
          {value}
        </span>
      ) : (
        value
      ),
    );
    offset = index + value.length;
  }
  if (offset < line.length) result.push(line.slice(offset));
  return result.length ? result : [" "];
}

export function PearlCodePreview({
  path,
  content,
  jumpLine,
}: {
  path: string;
  content: string;
  jumpLine?: number | null;
}) {
  const kind = language(path);
  const container = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => content.split("\n"), [content]);
  const [first, setFirst] = useState(0);
  const visible = 240;
  const lineStep = Math.min(19, 8_000_000 / Math.max(1, lines.length));
  const start = Math.max(0, Math.min(first, lines.length - 1));
  const end = Math.min(lines.length, start + visible);
  useEffect(() => {
    if (jumpLine && container.current)
      container.current.scrollTop = Math.max(0, jumpLine - 5) * lineStep;
  }, [jumpLine, lineStep]);
  return (
    <div
      ref={container}
      className="pearl-code-preview"
      role="region"
      aria-label="Code preview"
      onScroll={(event) =>
        setFirst(Math.floor(event.currentTarget.scrollTop / lineStep))
      }
    >
      <div className="pearl-code-lines">
        <div style={{ height: start * lineStep }} aria-hidden="true" />
        {lines.slice(start, end).map((line, index) => (
          <div className="pearl-code-line" key={start + index}>
            <span className="pearl-code-number" aria-hidden="true">
              {start + index + 1}
            </span>
            <code>
              {highlightedLine(
                line.length > 10_000
                  ? `${line.slice(0, 10_000)} … [line clipped for display]`
                  : line,
                kind,
              )}
            </code>
          </div>
        ))}
        <div
          style={{ height: (lines.length - end) * lineStep }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
