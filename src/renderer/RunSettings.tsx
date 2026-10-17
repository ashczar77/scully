import { useEffect, useState } from "react";
import type { DesktopAPI, Task } from "../shared/contracts";
import type { Run } from "../shared/runs";
import type { UsageSnapshot } from "../shared/usage";
import { UsagePolicyPanel } from "./UsagePolicyPanel";
import { UsageAlertsPanel } from "./UsageAlertsPanel";
import { CostPanel } from "./CostPanel";

export function RunSettings({
  api,
  task,
  runId,
}: {
  api: DesktopAPI;
  task?: Task;
  runId?: string | null;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [session, setSession] = useState<
    import("../shared/runs").SessionInfo | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRun(null);
    setError("");
    if (!task) return;
    api
      .runs(task.id)
      .then((items) => {
        if (active)
          setRun(items.find((item) => item.id === runId) || items[0] || null);
      })
      .catch(() => {
        if (active) setError("Could not load run settings.");
      });
    api
      .session()
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {});
    const off = api.onRun((next) => {
      if (active && next.taskId === task.id && (!runId || next.id === runId))
        setRun(next);
    });
    return () => {
      active = false;
      off();
    };
  }, [api, task?.id, runId]);
  useEffect(() => {
    let active = true;
    setUsage(null);
    if (!run) return;
    api
      .usageForRun(run.id)
      .then((value) => {
        if (active) setUsage(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, run]);
  return (
    <section
      aria-label="Selected task run settings"
      className="run-settings-page"
    >
      <h2>Run usage</h2>
      {!task ? (
        <div className="settings-card">
          <h3>Choose a task</h3>
          <p>
            Select a task from the left panel to see its run usage settings.
          </p>
        </div>
      ) : !run ? (
        <div className="settings-card">
          <h3>No run prepared yet</h3>
          <p>
            Prepare a project plan for {task.title} to configure its run.
            Defaults apply until then.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            Settings for {task.title}. Changes to run limits may require a fresh
            review before the next model request.
          </p>
          <UsagePolicyPanel
            run={run}
            mode={task.mode}
            session={session}
            api={api}
            onUpdate={setRun}
          />
          <UsageAlertsPanel
            run={run}
            usage={usage}
            api={api}
            onSaveTokens={() => {
              void api
                .saveTokensForRemaining(run.id)
                .catch(() => setError("Could not lower future usage."));
            }}
            onStop={() => {
              void (
                run.replies?.some((reply) => reply.status === "answering")
                  ? api.stopReply(run.id)
                  : api.stopRun(run.id)
              )
                .then(setRun)
                .catch(() => setError("Could not stop this run."));
            }}
          />
          <CostPanel run={run} api={api} />
          <section className="settings-card" aria-label="Model token usage">
            <h3>Recorded model usage</h3>
            <p>
              {!usage
                ? "Usage information is unavailable."
                : usage.requests === 0
                  ? "No model requests yet."
                  : `${usage.inputTokens.toLocaleString()} input and ${usage.outputTokens.toLocaleString()} output tokens reported across ${usage.measured} measured requests. ${usage.pending} pending; ${usage.unknown} with unknown usage.`}
            </p>
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
