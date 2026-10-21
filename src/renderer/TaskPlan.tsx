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
        if (live)
          setPlannedRun(
            runs.find(
              (run) =>
                !!run.plan &&
                (run.planning
                  ? (!!run.planning.planReview ||
                      !!run.planning.proposal ||
                      !!run.planning.approved) &&
                    !run.planning.questions.some(
                      (question) => question.status === "pending",
                    )
                  : !!run.approvedLineup &&
                    planQuestions(run.plan).length === 0),
            ) || null,
          );
      })
      .catch(() => {
        if (live) setPlannedRun(null);
      });
    return () => {
      live = false;
    };
  }, [api, task.id]);
  if (!plannedRun?.plan) return null;
  const display = visiblePlan(plannedRun.plan, false);
  return (
    <section className="task-plan" id="task-full-plan" aria-label="Full plan">
      <div className="task-plan-heading">
        <div>
          <span className="eyebrow">PEARL'S PLAN</span>
          <h2>Full plan</h2>
        </div>
        <CopyTextActions text={display} copyText={api.copyText} />
      </div>
      <RichText text={display} />
    </section>
  );
}
