import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  Image,
  RefreshCw,
  X,
} from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat } from "../shared/pearl-chat";
import type {
  FileReview,
  GitView,
  WorkspaceEntry,
} from "../shared/pearl-workspace";

export type Inspector = {
  kind: "files" | "git" | "review" | "sandbox";
  turnId?: string;
};
type Line = { kind: "same" | "added" | "removed"; text: string };

function fileIcon(path: string, size = 15) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const icon = [
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "css",
    "scss",
    "html",
    "xml",
    "svg",
  ].includes(extension || "") ? (
    <FileCode2 size={size} />
  ) : ["json", "jsonc"].includes(extension || "") ? (
    <FileJson size={size} />
  ) : ["md", "mdx", "txt", "log"].includes(extension || "") ? (
    <FileText size={size} />
  ) : ["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(extension || "") ? (
    <Image size={size} />
  ) : (
    <File size={size} />
  );
  return (
    <span
      className={`pearl-file-icon pearl-file-${extension || "plain"}`}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

export function reviewLines(before: string, after: string): Line[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 160_000)
    return [
      ...a.slice(0, 200).map((text) => ({ kind: "removed" as const, text })),
      ...b.slice(0, 200).map((text) => ({ kind: "added" as const, text })),
    ];
  const grid = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      grid[i][j] =
        a[i] === b[j]
          ? grid[i + 1][j + 1] + 1
          : Math.max(grid[i + 1][j], grid[i][j + 1]);
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i++] });
      j++;
    } else if (
      j < b.length &&
      (i === a.length || grid[i][j + 1] > grid[i + 1][j])
    ) {
      lines.push({ kind: "added", text: b[j++] });
    } else {
      lines.push({ kind: "removed", text: a[i++] });
    }
  }
  return lines;
}

export function PearlWorkspacePanel({
  api,
  chat,
  inspector,
  onClose,
  onUndo,
  width,
  onResizeStart,
  onOpenFile,
  closing = false,
  collapseReady = false,
}: {
  api: DesktopAPI;
  chat: PearlChat;
  inspector: Inspector;
  onClose: () => void;
  onUndo: (turnId: string) => void;
  width: number;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenFile: (file: {
    path: string;
    content?: string;
    review?: FileReview;
  }) => void;
  closing?: boolean;
  collapseReady?: boolean;
}) {
  const [entries, setEntries] = useState<Record<string, WorkspaceEntry[]>>({});
  const [exhausted, setExhausted] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [git, setGit] = useState<GitView | null>(null);
  const [commit, setCommit] = useState<string | undefined>();
  const [commitFiles, setCommitFiles] = useState<
    { status: string; path: string }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const task =
    chat.taskChanges?.find((item) => item.turnId === inspector.turnId) ||
    chat.taskChanges?.at(-1);

  useEffect(() => {
    setEntries({});
    setExhausted([]);
    setExpanded([]);
    setPath("");
    setGit(null);
    setError("");
    if (!chat.project?.approved) return;
    setLoading(true);
    const work =
      inspector.kind === "files"
        ? api
            .listPearlProjectFiles(chat.id)
            .then((items) => setEntries({ "": items }))
        : inspector.kind === "git"
          ? api.pearlGitView(chat.id).then(setGit)
          : Promise.resolve();
    void work
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, [
    api,
    chat.id,
    chat.project?.path,
    chat.project?.approved,
    inspector.kind,
    refreshKey,
  ]);

  async function expand(directory: string) {
    if (expanded.includes(directory)) {
      setExpanded(expanded.filter((item) => item !== directory));
      return;
    }
    try {
      const items = await api.listPearlProjectFiles(chat.id, directory);
      setEntries((current) => ({ ...current, [directory]: items }));
      setExpanded((current) => [...current, directory]);
    } catch (cause) {
      setError(String(cause));
    }
  }
  async function loadMore(directory: string) {
    try {
      const next = await api.listPearlProjectFiles(
        chat.id,
        directory,
        (entries[directory] || []).length,
      );
      setEntries((current) => ({
        ...current,
        [directory]: [...(current[directory] || []), ...next],
      }));
      if (next.length < 500) setExhausted((current) => [...current, directory]);
    } catch (cause) {
      setError(String(cause));
    }
  }
  async function openFile(file: string) {
    setPath(file);
    setError("");
    try {
      if (inspector.kind === "files")
        onOpenFile({
          path: file,
          content: await api.readPearlProjectFile(chat.id, file),
        });
      else if (inspector.kind === "git")
        onOpenFile({
          path: file,
          content: await api.pearlGitDiff(chat.id, file, commit),
        });
      else if (task)
        onOpenFile({
          path: file,
          review: await api.reviewPearlTaskFile(chat.id, task.turnId, file),
        });
    } catch (cause) {
      setError(String(cause));
    }
  }
  function tree(directory = "", depth = 0): ReactNode {
    const items = entries[directory] || [];
    return (
      <>
        {items.map((entry) => {
          const open = expanded.includes(entry.path);
          return (
            <div key={entry.path}>
              <button
                className={`pearl-inspector-item pearl-tree-item${path === entry.path ? " selected" : ""}`}
                style={{ paddingLeft: 12 + depth * 16 }}
                onClick={() =>
                  entry.kind === "directory"
                    ? void expand(entry.path)
                    : void openFile(entry.path)
                }
              >
                {entry.kind === "directory" ? (
                  <>
                    <span className="pearl-tree-chevron">
                      {open ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </span>
                    <span
                      className="pearl-file-icon pearl-file-folder"
                      aria-hidden="true"
                    >
                      {open ? <FolderOpen size={15} /> : <Folder size={15} />}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pearl-tree-chevron" />
                    {fileIcon(entry.path)}
                  </>
                )}
                <span>{entry.path.split("/").at(-1)}</span>
              </button>
              {entry.kind === "directory" &&
                open &&
                tree(entry.path, depth + 1)}
            </div>
          );
        })}
        {items.length > 0 &&
          items.length % 500 === 0 &&
          !exhausted.includes(directory) && (
            <button
              className="pearl-inspector-item"
              style={{ paddingLeft: 12 + depth * 16 }}
              onClick={() => void loadMore(directory)}
            >
              Load more files
            </button>
          )}
      </>
    );
  }
  return (
    <aside
      className={`pearl-inspector${closing ? " is-closing" : ""}${collapseReady ? " is-collapse-ready" : ""}`}
      style={{ width }}
      aria-hidden={closing}
      inert={closing}
      aria-label={
        inspector.kind === "files"
          ? "Files"
          : inspector.kind === "git"
            ? "Git history"
            : "Task review"
      }
    >
      <div
        className="pearl-inspector-resize"
        role="separator"
        aria-label="Resize panel"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
      />
      <div className="pearl-inspector-header">
        <strong>
          {inspector.kind === "files"
            ? "Files"
            : inspector.kind === "git"
              ? "Git changes"
              : "Task changes"}
        </strong>
        <div className="pearl-inspector-actions">
          <button
            aria-label="Refresh panel"
            title="Refresh"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={16} />
          </button>
          <button aria-label="Close panel" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      {!chat.project?.approved ? (
        <p className="pearl-inspector-note">
          Choose and approve a project to browse its files.
        </p>
      ) : (
        <>
          {loading && <p className="pearl-inspector-note">Loading…</p>}
          {error && (
            <p className="pearl-inspector-error" role="alert">
              {error}
            </p>
          )}
          {inspector.kind === "files" && (
            <div className="pearl-inspector-list" aria-label="Project files">
              {tree()}
            </div>
          )}
          {inspector.kind === "git" && git && (
            <div className="pearl-inspector-list">
              {git.state !== "ready" ? (
                <p className="pearl-inspector-note">
                  {git.detail || "No Git repository in this project."}
                </p>
              ) : (
                <>
                  <div className="pearl-git-branch">
                    <GitBranch size={15} aria-hidden="true" />
                    <span>{git.branch || "Detached HEAD"}</span>
                    <small>Current branch</small>
                  </div>
                  <div className="pearl-inspector-section pearl-git-section">
                    Working changes <span>{git.changes?.length || 0}</span>
                  </div>
                  {git.changes?.length ? (
                    git.changes.map((item) => (
                      <button
                        key={item.path}
                        className={`pearl-inspector-item pearl-git-file${path === item.path && !commit ? " selected" : ""}`}
                        onClick={() => {
                          setCommit(undefined);
                          void api
                            .pearlGitDiff(chat.id, item.path)
                            .then((value) => {
                              setPath(item.path);
                              onOpenFile({ path: item.path, content: value });
                            })
                            .catch((cause) => setError(String(cause)));
                        }}
                      >
                        {fileIcon(item.path)}
                        <span className="pearl-file-label">{item.path}</span>
                        <span className="pearl-git-status">{item.status}</span>
                      </button>
                    ))
                  ) : (
                    <p className="pearl-inspector-note">Working tree clean</p>
                  )}
                  <div className="pearl-inspector-section pearl-git-section">
                    <History size={14} aria-hidden="true" /> Commit history{" "}
                    <span>{git.commits?.length || 0}</span>
                  </div>
                  {git.commits?.map((item) => (
                    <div className="pearl-git-commit-group" key={item.hash}>
                      <button
                        className={`pearl-inspector-item pearl-commit${commit === item.hash ? " selected" : ""}`}
                        onClick={() => {
                          setCommit(item.hash);
                          setPath("");
                          void api
                            .pearlGitCommitFiles(chat.id, item.hash)
                            .then(setCommitFiles)
                            .catch((cause) => setError(String(cause)));
                        }}
                        title={item.hash}
                      >
                        <span className="pearl-git-node" aria-hidden="true" />
                        <span className="pearl-commit-body">
                          <span className="pearl-commit-subject">
                            {item.subject}
                          </span>
                          <small>
                            {item.author} · {item.date.slice(0, 10)}
                          </small>
                        </span>
                        <code>{item.hash.slice(0, 8)}</code>
                      </button>
                      {commit === item.hash &&
                        commitFiles.map((file) => (
                          <button
                            key={file.path}
                            className={`pearl-inspector-item pearl-commit-file${path === file.path ? " selected" : ""}`}
                            onClick={() => void openFile(file.path)}
                          >
                            {fileIcon(file.path)}
                            <span className="pearl-file-label">
                              {file.path}
                            </span>
                            <span className="pearl-git-status">
                              {file.status}
                            </span>
                          </button>
                        ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {inspector.kind === "review" && (
            <div className="pearl-inspector-list">
              {!task ? (
                <p className="pearl-inspector-note">
                  No task changes recorded yet.
                </p>
              ) : (
                <>
                  {task.reason && (
                    <p className="pearl-inspector-error">{task.reason}</p>
                  )}
                  <div className="pearl-inspector-section">
                    {task.files.length} changed project item
                    {task.files.length === 1 ? "" : "s"}
                  </div>
                  {task.files.map((file) => (
                    <button
                      key={file.path}
                      className="pearl-inspector-item"
                      onClick={() => void openFile(file.path)}
                    >
                      <span className={`pearl-change-kind ${file.kind}`}>
                        {file.kind}
                      </span>
                      {file.path}
                      {file.entry === "directory" ? "/" : ""}
                    </button>
                  ))}
                  {task.undone ? (
                    <p className="pearl-inspector-note">Changes undone.</p>
                  ) : (
                    task.undoAvailable &&
                    task.files.length > 0 && (
                      <button
                        className="pearl-inspector-undo"
                        onClick={() => onUndo(task.turnId)}
                      >
                        Undo task changes
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
