import type { ReactNode } from "react";

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
}: {
  path: string;
  content: string;
}) {
  const kind = language(path);
  const lines = content.split("\n");
  return (
    <div className="pearl-code-preview" role="region" aria-label="Code preview">
      <div className="pearl-code-lines">
        {lines.map((line, index) => (
          <div className="pearl-code-line" key={index}>
            <span className="pearl-code-number" aria-hidden="true">
              {index + 1}
            </span>
            <code>{highlightedLine(line, kind)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
