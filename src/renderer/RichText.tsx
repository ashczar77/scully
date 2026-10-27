import { useState } from "react";
import { Copy } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import remarkParse from "remark-parse";

type MarkdownNode = {
  type: string;
  value?: string;
  alt?: string;
  children?: MarkdownNode[];
};
const parser = unified().use(remarkParse).use(remarkGfm);

/** Add reading breaks to long plain replies without rewriting their content. */
export function readablePearlMarkdown(text: string): string {
  if (text.length < 500 || /\r?\n/u.test(text) || /[`*_\[\]]/u.test(text))
    return text;
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"])/u);
  if (sentences.length < 3) return text;
  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 320) {
      paragraphs.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}

export function plainTextFromMarkdown(markdown: string): string {
  function text(node: MarkdownNode): string {
    if (node.type === "image") return node.alt || "";
    if (
      node.type === "text" ||
      node.type === "inlineCode" ||
      node.type === "code"
    )
      return node.value || "";
    if (node.type === "break") return "\n";
    const children = (node.children || []).map(text);
    if (node.type === "list") return children.join("\n");
    if (node.type === "listItem") return children.join("\n");
    if (node.type === "tableRow") return children.join("\t");
    if (node.type === "root")
      return (node.children || [])
        .map(
          (child, index, siblings) =>
            (index
              ? siblings[index - 1].type === "paragraph" &&
                child.type === "paragraph"
                ? "\n\n"
                : "\n"
              : "") + text(child),
        )
        .join("");
    if (["paragraph", "heading", "blockquote", "table"].includes(node.type))
      return children.join("");
    return children.join("");
  }
  return text(parser.parse(markdown) as MarkdownNode).trim();
}

export function RichText({
  text,
  readableProse = false,
  onOpenLink,
}: {
  text: string;
  readableProse?: boolean;
  onOpenLink?: (url: string) => void;
}) {
  return (
    <div className="rich-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href, children }) {
            return href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  if (!onOpenLink) return;
                  event.preventDefault();
                  onOpenLink(href);
                }}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          img({ alt }) {
            return <span>{alt || "Image"}</span>;
          },
        }}
      >
        {readableProse ? readablePearlMarkdown(text) : text}
      </Markdown>
    </div>
  );
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
