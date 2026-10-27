import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type { FileReview } from "../shared/pearl-workspace";
import { PearlCodePreview } from "./PearlCodePreview";
import { lineChanges } from "./pearl-line-diff";

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
  const tabStrip = useRef<HTMLDivElement>(null);
  const comparison = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ left: false, right: false });
  const [beforeWidth, setBeforeWidth] = useState(50);
  useLayoutEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const update = () =>
      setTabEdges({
        left: strip.scrollLeft > 2,
        right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2,
      });
    const selected = strip.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (selected && typeof strip.scrollBy === "function") {
      const stripRect = strip.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      if (selectedRect.left < stripRect.left)
        strip.scrollBy({
          left: selectedRect.left - stripRect.left,
          behavior: "smooth",
        });
      else if (selectedRect.right > stripRect.right)
        strip.scrollBy({
          left: selectedRect.right - stripRect.right,
          behavior: "smooth",
        });
    }
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [files.length, activeId]);
  const content = active?.review?.after ?? active?.content ?? "";
  const before = active?.review?.before ?? "";
  const changes = useMemo(
    () => lineChanges(before, content),
    [before, content],
  );
  useEffect(() => {
    setMode(active?.review ? "changes" : "current");
    setQuery("");
    setMatchLine(null);
  }, [active?.id]);
  useEffect(() => {
    if (!menuTabId) return;
    const dismiss = (event: globalThis.PointerEvent) => {
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
  function scrollTabs(direction: -1 | 1) {
    const strip = tabStrip.current;
    strip?.scrollBy?.({
      left: direction * Math.max(160, strip.clientWidth * 0.65),
      behavior: "smooth",
    });
  }
  function startComparisonResize(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = comparison.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    event.preventDefault();
    const move = (next: globalThis.PointerEvent) =>
      setBeforeWidth(
        Math.max(
          25,
          Math.min(
            75,
            Math.round(((next.clientX - bounds.left) / bounds.width) * 100),
          ),
        ),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }
  return (
    <section className="pearl-file-workbench" aria-label="File editor">
      <header className="pearl-file-workbench-head">
        <button
          type="button"
          className="pearl-file-tab-scroll"
          aria-label="Scroll tabs left"
          disabled={!tabEdges.left}
          onClick={() => scrollTabs(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div
          ref={tabStrip}
          className={`pearl-file-workbench-tabs${tabEdges.left ? " has-left-overflow" : ""}${tabEdges.right ? " has-right-overflow" : ""}`}
          role="tablist"
          aria-label="Open files"
          onWheel={(event) => {
            if (event.deltaX || !event.deltaY) return;
            const strip = tabStrip.current;
            if (strip && strip.scrollWidth > strip.clientWidth) {
              event.preventDefault();
              strip.scrollLeft += event.deltaY;
            }
          }}
          onScroll={() => {
            const strip = tabStrip.current;
            if (strip)
              setTabEdges({
                left: strip.scrollLeft > 2,
                right:
                  strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2,
              });
          }}
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
        <button
          type="button"
          className="pearl-file-tab-scroll"
          aria-label="Scroll tabs right"
          disabled={!tabEdges.right}
          onClick={() => scrollTabs(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
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
        ) : (
          <div
            className="pearl-file-workbench-side-by-side"
            ref={comparison}
            style={{
              gridTemplateColumns: `minmax(0, ${beforeWidth}fr) 6px minmax(0, ${100 - beforeWidth}fr)`,
            }}
          >
            <section>
              <strong>Before</strong>
              <PearlCodePreview
                key={`${active.id}:before`}
                path={active.path}
                content={before}
                changedLines={changes.removed}
                changeKind="removed"
              />
            </section>
            <div
              className="pearl-file-comparison-resize"
              role="separator"
              aria-label="Resize comparison"
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={beforeWidth}
              tabIndex={0}
              onPointerDown={startComparisonResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  setBeforeWidth((value) =>
                    Math.max(
                      25,
                      Math.min(
                        75,
                        value + (event.key === "ArrowLeft" ? -5 : 5),
                      ),
                    ),
                  );
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  setBeforeWidth(event.key === "Home" ? 25 : 75);
                }
              }}
            />
            <section>
              <strong>After</strong>
              <PearlCodePreview
                key={`${active.id}:after`}
                path={active.path}
                content={content}
                jumpLine={matchLine}
                changedLines={changes.added}
                changeKind="added"
              />
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
