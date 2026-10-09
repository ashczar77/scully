import { useEffect, useState } from "react";
import type { Teammate } from "../shared/contracts";
import type { InFlightRequest, Run } from "../shared/runs";

const activity: Record<InFlightRequest["name"], string> = {
  propose_plan: "preparing a plan",
  propose_files: "drafting changes",
  audit_chunk: "reviewing a writer branch",
  audit_files: "reviewing the combined draft",
  specialist_audit: "reviewing the selected focus",
  respond_to_audit: "responding to findings",
};

export function InFlightStatus({ run, team }: { run: Run; team: Teammate[] }) {
  const [now, setNow] = useState(() => Date.now());
  const requests = run.inFlightRequests || [];
  const active = ["planning", "building", "auditing"].includes(run.status);
  useEffect(() => {
    if (!active || !requests.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, run.inFlightRequests, requests.length]);
  if (!active || !requests.length) return null;
  return (
    <section className="settings-card" aria-label="Live request progress">
      <h3>Work in progress</h3>
      <p>
        These requests are in flight. Elapsed time is measured locally; response
        content appears only after each structured request completes.
      </p>
      <ul>
        {requests.map((request) => {
          const start = Date.parse(request.startedAt);
          const seconds = Number.isFinite(start)
            ? Math.max(0, Math.floor((now - start) / 1000))
            : 0;
          const name =
            team.find((member) => member.id === request.actor)?.name ||
            request.actor;
          return (
            <li key={request.id}>
              {name}: {activity[request.name]}{" "}
              <span aria-live="off">({seconds}s waiting)</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
