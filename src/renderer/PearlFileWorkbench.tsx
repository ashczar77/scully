import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Search, X } from "lucide-react";
import type { FileReview } from "../shared/pearl-workspace";
import { PearlCodePreview } from "./PearlCodePreview";
import { reviewLines } from "./PearlWorkspacePanel";

export type WorkbenchFile = {
  id: string;
  path: string;
  source: "Local" | "Sandbox";
  content?: string;
  review?: FileReview;
};

export function PearlFileWorkbench({
  files,
  activeId,
  onSelect,
  onCloseFile,
  onCloseFiles,
  onClose,
}: {
  files: WorkbenchFile[];
  activeId: string;
  onSelect: (id: string) => void;
  onCloseFile: (id: string) => void;
  onCloseFiles?: (ids: string[]) => void;
  onClose: () => void;
}) {
  const active = files.find((file) => file.id === activeId) || files.at(-1);
  const [mode, setMode] = useState<"current" | "changes">("changes");
  const [query, setQuery] = useState("");
  const [matchLine, setMatchLine] = useState<number | null>(null);
  const [menuTabId, setMenuTabId] = useState<string | null>(null);
  const content = active?.review?.after ?? active?.content ?? "";
  const before = active?.review?.before ?? "";
  const compactDiff = useMemo(
    () =>
      active?.review &&
      before.length + content.length <= 1_000_000 &&
      before.split("\n").length * content.split("\n").length <= 160_000
        ? reviewLines(before, content)
        : null,
    [active?.review, before, content],
  );
  useEffect(() => {
    setMode(active?.review ? "changes" : "current");
    setQuery("");
    setMatchLine(null);
  }, [active?.id]);
  useEffect(() => {
    if (!menuTabId) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".pearl-file-workbench-menu-wrap")
      )
        setMenuTabId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuTabId(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menuTabId]);
  if (!active) return null;
  const menuIndex = files.findIndex((file) => file.id === menuTabId);
  function closeMany(ids: string[]) {
    if (!ids.length) return;
    if (onCloseFiles) onCloseFiles(ids);
    else ids.forEach(onCloseFile);
    setMenuTabId(null);
  }
  function find() {
    if (!query) return;
    const index = content.toLowerCase().indexOf(query.toLowerCase());
    setMatchLine(index < 0 ? null : content.slice(0, index).split("\n").length);
  }
  return (
    <section className="pearl-file-workbench" aria-label="File editor">
      <header className="pearl-file-workbench-head">
        <div
          className="pearl-file-workbench-tabs"
          role="tablist"
          aria-label="Open files"
        >
          {files.map((file) => (
            <div className="pearl-file-workbench-tab" key={file.id}>
              <button
                role="tab"
                aria-selected={file.id === active.id}
                onClick={() => onSelect(file.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuTabId(file.id);
                }}
                title={file.path}
              >
                {file.path.split("/").at(-1)}
              </button>
              <button
                aria-label={`Close ${file.path}`}
                onClick={() => onCloseFile(file.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="pearl-file-workbench-menu-wrap">
          <button
            type="button"
            aria-label="Tab actions"
            aria-expanded={menuTabId !== null}
            onClick={() => setMenuTabId(menuTabId ? null : active.id)}
          >
            <MoreHorizontal size={17} />
          </button>
          {menuTabId && menuIndex >= 0 && (
            <div
              className="pearl-file-workbench-menu"
              role="menu"
              aria-label="Tab actions"
            >
              <button role="menuitem" onClick={() => closeMany([menuTabId])}>
                Close tab
              </button>
              <button
                role="menuitem"
                onClick={() => closeMany(files.map((file) => file.id))}
              >
                Close all tabs
              </button>
              <button
                role="menuitem"
                disabled={menuIndex === 0}
                onClick={() =>
                  closeMany(files.slice(0, menuIndex).map((file) => file.id))
                }
              >
                Close tabs to the left
              </button>
              <button
                role="menuitem"
                disabled={menuIndex === files.length - 1}
                onClick={() =>
                  closeMany(files.slice(menuIndex + 1).map((file) => file.id))
                }
              >
                Close tabs to the right
              </button>
              <button
                role="menuitem"
                disabled={files.length === 1}
                onClick={() =>
                  closeMany(
                    files
                      .filter((file) => file.id !== menuTabId)
                      .map((file) => file.id),
                  )
                }
              >
                Close other tabs
              </button>
            </div>
          )}
        </div>
        <button aria-label="Close file editor" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="pearl-file-workbench-toolbar">
        <span title={active.path}>
          {active.source} / {active.path}
        </span>
        {active.review && (
          <div role="tablist" aria-label="File display">
            <button
              role="tab"
              aria-selected={mode === "changes"}
              onClick={() => setMode("changes")}
            >
              Changes
            </button>
            <button
              role="tab"
              aria-selected={mode === "current"}
              onClick={() => setMode("current")}
            >
              Current file
            </button>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            find();
          }}
        >
          <input
            aria-label="Find in file"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in file"
          />
          <button
            type="submit"
            className="pearl-file-find-button"
            aria-label="Find in file"
            title="Find in file"
          >
            <Search size={16} aria-hidden="true" />
          </button>
        </form>
      </div>
      {query && matchLine !== null && (
        <p className="pearl-file-workbench-match">Found at line {matchLine}</p>
      )}
      <div className="pearl-file-workbench-content">
        {active.review?.binary ? (
          <p className="pearl-file-workbench-unavailable">
            Binary file preview is unavailable. Review the changed file metadata
            before approving sync.
          </p>
        ) : mode === "current" || !active.review ? (
          <PearlCodePreview
            key={`${active.id}:current`}
            path={active.path}
            content={content}
            jumpLine={matchLine}
          />
        ) : compactDiff ? (
          <pre className="pearl-diff" aria-label="File changes">
            {compactDiff.map((line, index) => (
              <div className={line.kind} key={index}>
                <span>
                  {line.kind === "added"
                    ? "+"
                    : line.kind === "removed"
                      ? "−"
                      : " "}
                </span>
                {line.text || " "}
              </div>
            ))}
          </pre>
        ) : (
          <div className="pearl-file-workbench-side-by-side">
            <section>
              <strong>Before</strong>
              <PearlCodePreview
                key={`${active.id}:before`}
                path={active.path}
                content={before}
              />
            </section>
            <section>
              <strong>After</strong>
              <PearlCodePreview
                key={`${active.id}:after`}
                path={active.path}
                content={content}
                jumpLine={matchLine}
              />
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
