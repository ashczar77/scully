import { useEffect, useState } from "react";
import type { DesktopAPI, Task } from "../shared/contracts";
import { CopyTextActions, RichText } from "./RichText";
import { planQuestions, visiblePlan } from "../shared/plan-conversation";
import type { Run } from "../shared/runs";

export function TaskPlan({ api, task }: { api: DesktopAPI; task: Task }) {
  const [plannedRun, setPlannedRun] = useState<Run | null>(null);
  useEffect(() => {
    let live = true;
    void api
      .runs(task.id)
      .then((runs) => {
        if (live) setPlannedRun(runs.find((run) => !!run.plan) || null);
      })
      .catch(() => {
        if (live) setPlannedRun(null);
      });
    return () => {
      live = false;
    };
  }, [api, task.id]);
  if (!plannedRun?.plan) return null;
  const draft =
    planQuestions(plannedRun.plan).length > 0 ||
    (task.mode === "plan" && !plannedRun.approvedLineup);
  const display = visiblePlan(plannedRun.plan, draft);
  return (
    <section
      className="task-plan"
      id="task-full-plan"
      aria-label={draft ? "Draft analysis" : "Full plan"}
    >
      <div className="task-plan-heading">
        <div>
          <span className="eyebrow">PEARL'S PLAN</span>
          <h2>{draft ? "Draft analysis" : "Full plan"}</h2>
        </div>
        <CopyTextActions text={display} copyText={api.copyText} />
      </div>
      <RichText text={display} />
    </section>
  );
}
