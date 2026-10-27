import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
  X,
} from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlChat } from "../shared/pearl-chat";
import type { PearlSandboxSnapshot } from "../shared/pearl-sandbox";
import type { PearlSandboxConnection } from "../shared/pearl-sandbox";
import type { FileReview } from "../shared/pearl-workspace";

export function PearlSandboxInspector({
  api,
  chat,
  onClose,
  width,
  onResizeStart,
  onOpenFile,
  onOpenSettings,
  closing = false,
  collapseReady = false,
}: {
  api: DesktopAPI;
  chat: PearlChat;
  onClose: () => void;
  width: number;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenFile: (review: FileReview) => void;
  onOpenSettings: () => void;
  closing?: boolean;
  collapseReady?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PearlSandboxSnapshot | null>(null);
  const [review, setReview] = useState<FileReview | null>(null);
  const [tab, setTab] = useState<"files" | "activity">("files");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState<PearlSandboxConnection | null>(
    null,
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const treeRevision = useRef("");
  const selectedBranch = chat.sandbox?.branches.find(
    (branch) => branch.id === chat.sandbox?.activeBranchId,
  );
  const checkpoint = selectedBranch?.headImage;
  const branchName = selectedBranch?.name;
  const activityRevision = `${selectedBranch?.checks.length || 0}:${
    chat.sandbox?.operations
      ?.map((operation) =>
        [
          operation.remoteId,
          operation.stage,
          operation.status,
          operation.resultImageId,
        ].join(":"),
      )
      .join("|") || ""
  }`;
  useEffect(() => {
    setSnapshot(null);
    setReview(null);
  }, [chat.id, branchName]);
  useEffect(() => {
    let live = true;
    if (typeof api.pearlSandboxConnection !== "function") {
      setConnection({ configured: false, projectId: "" });
      return () => {
        live = false;
      };
    }
    void api
      .pearlSandboxConnection()
      .then((value) => {
        if (live) setConnection(value);
      })
      .catch(() => {
        if (live) setConnection({ configured: false, projectId: "" });
      });
    return () => {
      live = false;
    };
  }, [api, revision]);
  useEffect(() => {
    if (!checkpoint) {
      setSnapshot(null);
      setError("");
      setLoading(false);
      return;
    }
    if (
      !connection?.configured ||
      connection.projectId !== chat.sandbox?.projectId
    ) {
      setSnapshot(null);
      setError("");
      setLoading(false);
      return;
    }
    let live = true;
    setError("");
    setLoading(true);
    void api
      .pearlSandboxSnapshot(chat.id)
      .then((value) => {
        if (live) {
          setSnapshot(value);
          const nextTreeRevision = `${value.branch}:${value.checkpoint}`;
          if (treeRevision.current !== nextTreeRevision) {
            treeRevision.current = nextTreeRevision;
            setExpanded(
              Array.from(
                new Set(
                  value.files.flatMap((file) =>
                    file.path
                      .split("/")
                      .slice(0, -1)
                      .map((_, index, parts) =>
                        parts.slice(0, index + 1).join("/"),
                      ),
                  ),
                ),
              ),
            );
          }
        }
      })
      .catch((cause) => {
        if (live) setError(String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    api,
    connection?.configured,
    connection?.projectId,
    chat.id,
    chat.sandbox?.status,
    checkpoint,
    branchName,
    activityRevision,
    revision,
  ]);
  async function openFile(path: string) {
    setError("");
    setReview(null);
    try {
      const result = await api.inspectPearlSandboxFile(chat.id, path);
      setReview(result);
      onOpenFile(result);
    } catch (cause) {
      setError(String(cause));
    }
  }
  function tree(directory = "", depth = 0) {
    if (!snapshot) return null;
    const prefix = directory ? `${directory}/` : "";
    const children = snapshot.files.filter((file) =>
      file.path.startsWith(prefix),
    );
    const folders = [
      ...new Set(
        children
          .map((file) => file.path.slice(prefix.length).split("/")[0])
          .filter((name) =>
            children.some((file) => file.path.startsWith(`${prefix}${name}/`)),
          ),
      ),
    ].sort();
    const files = children.filter(
      (file) => !file.path.slice(prefix.length).includes("/"),
    );
    return (
      <>
        {folders.map((name) => {
          const path = `${prefix}${name}`;
          const open = expanded.includes(path);
          return (
            <div key={path}>
              <button
                className="pearl-inspector-item"
                style={{ paddingLeft: 12 + depth * 16 }}
                aria-expanded={open}
                onClick={() =>
                  setExpanded((current) =>
                    open
                      ? current.filter((item) => item !== path)
                      : [...current, path],
                  )
                }
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {open ? <FolderOpen size={15} /> : <Folder size={15} />}
                <span>{name}</span>
              </button>
              {open && tree(path, depth + 1)}
            </div>
          );
        })}
        {files.map((file) => (
          <button
            key={file.path}
            className={`pearl-inspector-item${review?.path === file.path ? " selected" : ""}`}
            style={{ paddingLeft: 25 + depth * 16 }}
            onClick={() => void openFile(file.path)}
            title={file.path}
            aria-label={file.path}
          >
            <FileCode2 size={15} aria-hidden="true" />
            <span>{file.path.split("/").at(-1)}</span>
            {file.changed && (
              <span
                className="pearl-sandbox-changed"
                role="img"
                aria-label="Changed since upload"
                title="Changed since upload"
              />
            )}
          </button>
        ))}
      </>
    );
  }
  return (
    <aside
      className={`pearl-inspector pearl-sandbox-inspector${closing ? " is-closing" : ""}${collapseReady ? " is-collapse-ready" : ""}`}
      style={{ width }}
      aria-label="Sandbox view"
      aria-hidden={closing}
      inert={closing}
    >
      <div
        className="pearl-inspector-resize"
        role="separator"
        aria-label="Resize panel"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
      />
      <div className="pearl-inspector-header">
        <strong>Sandbox view</strong>
        <div className="pearl-inspector-actions">
          <button
            aria-label="Refresh panel"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
          </button>
          <button aria-label="Close panel" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      {!checkpoint && (
        <p className="pearl-inspector-note">
          No saved Sandbox checkpoint is attached to this chat.
        </p>
      )}
      {checkpoint &&
        connection &&
        (!connection.configured ||
          connection.projectId !== chat.sandbox?.projectId) && (
          <div className="pearl-inspector-connection" role="status">
            <p>
              {connection.configured
                ? "This chat uses a different Nebius Sandbox project. Connect that project in Settings to view its files."
                : "Connect to Nebius Sandbox in Settings to view this chat's files."}
            </p>
            <button onClick={onOpenSettings}>Open Settings</button>
          </div>
        )}
      {loading && !snapshot && (
        <p className="pearl-inspector-note">Loading saved checkpoint…</p>
      )}
      {error && (
        <p className="pearl-inspector-error" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <>
          <div className="pearl-sandbox-inspector-meta">
            <strong>{snapshot.branch}</strong>
            <small title={snapshot.checkpoint}>
              Checkpoint {snapshot.checkpoint.slice(0, 12)}
            </small>
          </div>
          <div
            className="pearl-sandbox-inspector-tabs"
            role="tablist"
            aria-label="Sandbox view sections"
          >
            <button
              role="tab"
              aria-selected={tab === "files"}
              onClick={() => setTab("files")}
            >
              Files ({snapshot.files.length})
            </button>
            <button
              role="tab"
              aria-selected={tab === "activity"}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
          </div>
          {tab === "files" && (
            <>
              <div className="pearl-inspector-list" aria-label="Sandbox files">
                {tree()}
              </div>
            </>
          )}
          {tab === "activity" && (
            <div className="pearl-inspector-list pearl-sandbox-activity">
              {[...snapshot.operations].reverse().map((operation, index) => (
                <div
                  className="pearl-sandbox-activity-item"
                  key={`${operation.remoteId}-${index}`}
                >
                  <strong>{operation.stage}</strong>
                  <span>{operation.status}</span>
                  {operation.path && <code>{operation.path}</code>}
                  <small>{operation.at}</small>
                  {operation.resultImageId && (
                    <code title={operation.resultImageId}>
                      Checkpoint {operation.resultImageId.slice(0, 12)}
                    </code>
                  )}
                </div>
              ))}
              {[...snapshot.checks].reverse().map((check, index) => (
                <details
                  className="pearl-sandbox-activity-item"
                  key={`check-${index}`}
                >
                  <summary>
                    <strong>
                      Check: {check.command} {check.args?.join(" ")}
                    </strong>
                    <span>
                      {check.passed ? "Passed" : "Failed"} (exit{" "}
                      {check.exitCode ?? "unknown"})
                    </span>
                  </summary>
                  <small>{check.at}</small>
                  {check.stdout && <pre>Output: {check.stdout}</pre>}
                  {check.stderr && <pre>Error: {check.stderr}</pre>}
                  <p>File writes from this check were discarded.</p>
                </details>
              ))}
              {!snapshot.operations.length && !snapshot.checks.length && (
                <p className="pearl-inspector-note">
                  No remote activity has been recorded yet.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
