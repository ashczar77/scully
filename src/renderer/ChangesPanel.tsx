import { useEffect, useMemo, useState } from "react";
import {
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
} from "lucide-react";
import type { DesktopAPI, Task } from "../shared/contracts";
import type { GitCommit, GitHistory } from "../shared/git-history";
import type { Run } from "../shared/runs";

const laneColors = [
  "#37d8c5",
  "#6c9dff",
  "#ce79f8",
  "#f4b85f",
  "#ec7184",
  "#9fce63",
];
const laneX = (lane: number) => 18 + Math.min(lane, 5) * 22;

export type GraphRow = {
  commit: GitCommit;
  lane: number;
  incoming: string[];
  outgoing: string[];
};

export function layoutGitGraph(commits: GitCommit[]): GraphRow[] {
  const active: string[] = [];
  return commits.map((commit) => {
    let lane = active.indexOf(commit.hash);
    if (lane < 0) {
      lane = active.length;
      active.push(commit.hash);
    }
    const incoming = [...active];
    active.splice(lane, 1);
    commit.parents.forEach((parent, index) => {
      if (!active.includes(parent))
        active.splice(Math.min(lane + index, active.length), 0, parent);
    });
    return { commit, lane, incoming, outgoing: [...active] };
  });
}

function CommitGraph({ row }: { row: GraphRow }) {
  const { commit, lane, incoming, outgoing } = row;
  return (
    <svg
      className="git-graph"
      width="150"
      height="58"
      viewBox="0 0 150 58"
      aria-hidden="true"
    >
      {incoming.map((hash, index) =>
        hash === commit.hash ? (
          <path
            key={`${hash}-in`}
            d={`M ${laneX(index)} 0 L ${laneX(lane)} 29`}
            stroke={laneColors[index % laneColors.length]}
          />
        ) : outgoing.includes(hash) ? (
          <path
            key={`${hash}-pass`}
            d={`M ${laneX(index)} 0 L ${laneX(outgoing.indexOf(hash))} 58`}
            stroke={laneColors[index % laneColors.length]}
          />
        ) : null,
      )}
      {commit.parents.map((parent, index) => {
        const destination = outgoing.indexOf(parent);
        if (destination < 0) return null;
        const start = laneX(lane);
        const end = laneX(destination);
        return (
          <path
            key={`${parent}-${index}`}
            d={`M ${start} 29 C ${start} 45, ${end} 42, ${end} 58`}
            stroke={laneColors[destination % laneColors.length]}
          />
        );
      })}
      <circle
        cx={laneX(lane)}
        cy="29"
        r={commit.parents.length > 1 ? 8 : 6}
        fill="#13232b"
        stroke={laneColors[lane % laneColors.length]}
        strokeWidth="3"
      />
      {commit.parents.length > 1 && (
        <circle
          cx={laneX(lane)}
          cy="29"
          r="2"
          fill={laneColors[lane % laneColors.length]}
        />
      )}
    </svg>
  );
}

export function ChangesPanel({
  api,
  task,
  run,
  loaded,
  onAskPearl,
}: {
  api: DesktopAPI;
  task: Task;
  run: Run | null;
  loaded: boolean;
  onAskPearl: () => void;
}) {
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setHistory(null);
    if (!run?.projectWorkspace) return;
    let live = true;
    void api
      .gitHistory(run.id)
      .then((value) => {
        if (live) setHistory(value);
      })
      .catch(() => {
        if (live)
          setHistory({
            state: "unavailable",
            detail: "Git history could not be read.",
          });
      });
    return () => {
      live = false;
    };
  }, [api, run?.id, run?.status, run?.projectWorkspace?.path]);
  const rows = useMemo(
    () => (history?.state === "ready" ? layoutGitGraph(history.commits) : []),
    [history],
  );
  const selectedCommit =
    history?.state === "ready"
      ? history.commits.find((commit) => commit.hash === selected) ||
        history.commits[0]
      : null;
  async function refresh() {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      setHistory(await api.gitHistory(run.id));
    } catch {
      setError("Git history could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="changes-panel" aria-label="Changes">
      <header className="changes-header">
        <div>
          <span className="eyebrow">PROJECT HISTORY</span>
          <h2>Changes</h2>
          <p>{task.title}</p>
        </div>
        {run?.projectWorkspace && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCcw size={16} /> Refresh
          </button>
        )}
      </header>
      {!loaded || (run?.projectWorkspace && !history) ? (
        <p role="status">Loading project history...</p>
      ) : !run?.projectWorkspace || history?.state === "no-project" ? (
        <div className="git-empty-state">
          <FolderGit2 size={32} />
          <h3>Choose a project folder first</h3>
          <p>
            Pearl will ask where the team should work when she presents the plan
            and team. Git history will appear here once the folder is selected.
          </p>
          <button type="button" className="secondary" onClick={onAskPearl}>
            Talk to Pearl
          </button>
        </div>
      ) : history?.state === "no-repository" ? (
        <div className="git-empty-state">
          <GitBranch size={32} />
          <h3>Set up Git for this project</h3>
          <p>
            This project folder has no Git repository. Initialize one here to
            track commits, or ask Pearl to help you decide how to set it up.
          </p>
          <code>{run.projectWorkspace.path}</code>
          <div className="git-empty-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void api
                  .initializeGit(run.id)
                  .then(setHistory)
                  .catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Could not initialize Git.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Initialize Git here
            </button>
            <button type="button" className="secondary" onClick={onAskPearl}>
              Ask Pearl for help
            </button>
          </div>
          <p className="muted">
            Initializing Git creates repository metadata in this folder. It does
            not make a commit or add a remote.
          </p>
        </div>
      ) : history?.state === "unavailable" ? (
        <div className="git-empty-state">
          <h3>Git history is unavailable</h3>
          <p>{history.detail}</p>
        </div>
      ) : history?.state === "ready" ? (
        <>
          <div className="git-summary">
            <span>
              <GitBranch size={17} /> {history.branch}
            </span>
            <span>
              {history.commits.length}{" "}
              {history.commits.length === 1 ? "commit" : "commits"} shown
            </span>
            <span>
              {history.changes.length} uncommitted{" "}
              {history.changes.length === 1 ? "file" : "files"}
            </span>
          </div>
          <div className="git-workspace">
            <aside className="git-branches">
              <h3>Branches</h3>
              <div className="git-active-branch">
                <GitBranch size={16} /> {history.branch}
              </div>
              {history.branches
                .filter((name) => name !== history.branch)
                .map((name) => (
                  <div className="git-other-branch" key={name}>
                    <GitBranch size={15} /> {name}
                  </div>
                ))}
              <p>Actual history from the selected project folder.</p>
            </aside>
            <div className="git-timeline">
              <div className="git-timeline-heading">Commit graph</div>
              {history.changes.length > 0 && (
                <div className="git-working-tree">
                  <strong>Working tree</strong>
                  <span>
                    {history.changes.length} uncommitted{" "}
                    {history.changes.length === 1 ? "change" : "changes"}
                  </span>
                  <ul>
                    {history.changes.slice(0, 12).map((file, index) => (
                      <li key={`${file.path}-${index}`}>
                        <b>{file.status}</b>
                        {file.path}
                      </li>
                    ))}
                  </ul>
                  {history.changes.length > 12 && (
                    <small>And {history.changes.length - 12} more files</small>
                  )}
                </div>
              )}
              {rows.length ? (
                rows.map((row) => (
                  <button
                    type="button"
                    key={row.commit.hash}
                    className={`git-commit-row ${selectedCommit?.hash === row.commit.hash ? "is-selected" : ""}`}
                    onClick={() => setSelected(row.commit.hash)}
                  >
                    <CommitGraph row={row} />
                    <span className="git-commit-info">
                      <span className="git-commit-title">
                        {row.commit.parents.length > 1 && (
                          <GitMerge size={15} aria-label="Merge commit" />
                        )}
                        {row.commit.subject || "Untitled commit"}
                      </span>
                      <span className="git-commit-meta">
                        {row.commit.hash.slice(0, 8)} · {row.commit.author} ·{" "}
                        {row.commit.date.slice(0, 10)}
                      </span>
                    </span>
                    {row.commit.refs.length > 0 && (
                      <span className="git-ref">{row.commit.refs[0]}</span>
                    )}
                  </button>
                ))
              ) : (
                <div className="git-first-commit">
                  <GitCommitHorizontal size={21} />
                  <p>
                    No commits yet. The first commit will appear here after you
                    create it.
                  </p>
                </div>
              )}
            </div>
            <aside className="git-detail">
              {selectedCommit ? (
                <>
                  <span className="eyebrow">SELECTED COMMIT</span>
                  <h3>{selectedCommit.subject || "Untitled commit"}</h3>
                  <p>{selectedCommit.author}</p>
                  <time>{selectedCommit.date}</time>
                  <code>{selectedCommit.hash}</code>
                  {selectedCommit.refs.map((ref) => (
                    <span className="git-detail-ref" key={ref}>
                      {ref}
                    </span>
                  ))}
                  {selectedCommit.parents.length > 0 && (
                    <p>
                      Parent:{" "}
                      {selectedCommit.parents
                        .map((parent) => parent.slice(0, 8))
                        .join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p>Select a commit to inspect its details.</p>
              )}
            </aside>
          </div>
          {run.drafts.length > 0 && (
            <section className="git-run-diffs">
              <h3>Scully file changes</h3>
              <p>Review the files from this attempt in the project folder.</p>
              {run.drafts.map((file) => (
                <details key={file.path}>
                  <summary>
                    {file.before === null ? "Added" : "Changed"} · {file.path}
                  </summary>
                  <div className="diff-columns">
                    <section>
                      <h4>Before</h4>
                      <pre>{file.before ?? "(New file)"}</pre>
                    </section>
                    <section>
                      <h4>After</h4>
                      <pre>{file.content}</pre>
                    </section>
                  </div>
                </details>
              ))}
            </section>
          )}
        </>
      ) : null}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
