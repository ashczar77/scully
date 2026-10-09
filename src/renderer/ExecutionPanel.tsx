import { useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import type { ExecutionReview } from "../shared/execution";

export function ExecutionPanel({ api, run }: { api: DesktopAPI; run: Run }) {
  const [review, setReview] = useState<ExecutionReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execution action failed");
    } finally {
      setBusy(false);
    }
  }
  const running = run.executions?.some((e) => e.status === "running");
  const reviewCommand = run.commands?.find(
    (command) =>
      command.id === review?.commandId && command.revision === review.revision,
  );
  const reviewCriterion =
    reviewCommand?.findingLink?.criterion ||
    reviewCommand?.recheckOf?.criterion;
  return (
    <section className="settings-card" aria-label="Local execution">
      <h3>Run a check locally</h3>
      <p>
        Each check uses a fresh copy of the selected snapshot and draft. No
        dependencies are installed automatically. Prior command-review decisions
        do not grant execution permission.
      </p>
      <p className="muted">
        This is not a security sandbox. Approved programs can access your
        computer and network with your account permissions. Source files are not
        copied in full. Check results apply only to the displayed revision, not
        the whole project.
      </p>
      {(run.commands || [])
        .filter((c) => c.decision !== "denied")
        .map((c, i) => (
          <button
            key={c.id}
            className="secondary"
            disabled={busy || running || run.status !== "complete"}
            onClick={() =>
              act(async () => {
                setApproved(false);
                setReview(null);
                setReview(await api.reviewExecution(run.id, c.id));
              })
            }
          >
            Review local execution {i + 1}: {c.executable}
          </button>
        ))}
      {review && (
        <div className="command-proposal">
          <h4>Approve this exact local command</h4>
          {reviewCriterion && (
            <p>
              {reviewCommand?.recheckOf
                ? "Carried from the original failed check. "
                : ""}
              Proposed observation criterion: exit {reviewCriterion.exitCode}
              {reviewCriterion.outputIncludes
                ? ` and output contains ${JSON.stringify(reviewCriterion.outputIncludes)}`
                : ""}
              . This is not a correctness guarantee.
            </p>
          )}
          <pre>
            {JSON.stringify(
              {
                executable: review.executable,
                arguments: review.args,
                workingDirectory: review.cwd,
                timeoutSeconds: review.timeoutSeconds,
                executableSHA256: review.executableHash,
                draftRevision: review.revision,
              },
              null,
              2,
            )}
          </pre>
          <p>
            Expires {new Date(review.expiresAt).toLocaleTimeString()}. Output is
            limited to 64 KiB. No interactive input. Only PATH, workspace
            HOME/temp and locale (plus Windows SystemRoot) are passed, not your
            session API key or shell environment. This does not prevent programs
            reading other local files.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I permit this exact command to run on my computer.
          </label>
          <button
            className="primary"
            disabled={busy || !approved || running}
            onClick={() =>
              act(async () => {
                const token = review.token;
                setReview(null);
                setApproved(false);
                await api.executeCommand(token, true);
              })
            }
          >
            Approve and run locally
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setApproved(false);
            }}
          >
            Cancel execution review
          </button>
        </div>
      )}
      {(run.executions || []).map((e) => (
        <article className="command-proposal" key={e.id}>
          <h4>
            {e.executable.split(/[\\/]/).at(-1)} · {e.status}
          </h4>
          <p>
            Draft {e.revision.slice(0, 12)} · Exit code:{" "}
            {e.exitCode ?? "not available"}
            {e.signal ? ` · Signal: ${e.signal}` : ""}
          </p>
          <details>
            <summary>Executed command and location</summary>
            <pre>
              {JSON.stringify(
                {
                  executable: e.executable,
                  arguments: e.args,
                  cwd: e.cwd,
                  executableSHA256: e.executableHash,
                  startedAt: e.startedAt,
                  finishedAt: e.finishedAt,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {e.status === "exited" && (
            <p>
              {e.exitCode === 0
                ? "Process exited successfully. This does not establish complete test coverage or correctness."
                : "Process did not exit successfully. Review the output before continuing."}
            </p>
          )}
          {e.error && <p className="error">{e.error}</p>}
          <pre aria-label="Command output">
            {e.output || "No output captured."}
          </pre>
          {e.status === "running" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api.stopExecution(e.id);
                })
              }
            >
              Stop local check
            </button>
          )}
        </article>
      ))}
      <p className="muted">
        Stop and deadlines request termination. Detached descendants may
        survive; Windows currently stops the direct process only. Output is
        untrusted text, is saved locally and is not automatically sent to an
        auditor or provider.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
