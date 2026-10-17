import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";

// Model text is untrusted. Render supported Markdown as React nodes, never HTML.
export function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+\. )/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^---+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inline(text: string): ReactNode[] {
  const token = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|!?\[[^\]]+\]\([^)]+\))/g;
  const result: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > at) result.push(text.slice(at, index));
    const value = match[0];
    if (value.startsWith("`"))
      result.push(<code key={index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**"))
      result.push(<strong key={index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("*"))
      result.push(<em key={index}>{value.slice(1, -1)}</em>);
    else {
      const parts = /^!?\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      const label = parts?.[1] || value;
      const url = parts?.[2] || "";
      result.push(
        /^https?:\/\//i.test(url) && !value.startsWith("!") ? (
          <a key={index} href={url} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <span key={index}>{label}</span>
        ),
      );
    }
    at = index + value.length;
  }
  if (at < text.length) result.push(text.slice(at));
  return result;
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index]))
        code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>);
      index++;
      continue;
    }
    if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      const items: ReactNode[] = [];
      const ordered = /^\s*\d+\. /.test(line);
      while (
        index < lines.length &&
        /^\s*(?:[-*+] |\d+\. )/.test(lines[index])
      ) {
        items.push(
          <li key={items.length}>
            {inline(lines[index].replace(/^\s*(?:[-*+] |\d+\. )/, ""))}
          </li>,
        );
        index++;
      }
      blocks.push(
        ordered ? (
          <ol key={blocks.length}>{items}</ol>
        ) : (
          <ul key={blocks.length}>{items}</ul>
        ),
      );
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={blocks.length} />);
      index++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(?:```|#{1,6} |[-*+] |\d+\. |---+\s*$)/.test(lines[index])
    )
      paragraph.push(lines[index++].trim());
    if (paragraph.length)
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="rich-text">{blocks}</div>;
}

export function CopyTextActions({
  text,
  copyText,
}: {
  text: string;
  copyText: (value: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState<"text" | "markdown" | null>(null);
  const [error, setError] = useState(false);
  async function copy(value: string, kind: "text" | "markdown") {
    try {
      await copyText(value);
      setCopied(kind);
      setError(false);
    } catch {
      setCopied(null);
      setError(true);
    }
  }
  return (
    <div className="copy-text-actions">
      <button
        type="button"
        className="text-button"
        onClick={() => void copy(plainTextFromMarkdown(text), "text")}
      >
        <Copy size={14} /> {copied === "text" ? "Copied text" : "Copy text"}
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() => void copy(text, "markdown")}
      >
        <Copy size={14} />{" "}
        {copied === "markdown" ? "Copied Markdown" : "Copy Markdown"}
      </button>
      {error && <span role="alert">Could not copy. Try again.</span>}
    </div>
  );
}
