import { useState } from "react";
import type { Run, RunAPI } from "../shared/runs";
import { initialTeam, type Teammate } from "../shared/contracts";
import { suggestionsVisible } from "../shared/suggestions";
export function SuggestionsPanel({
  run,
  api,
  team = initialTeam,
}: {
  run: Run;
  api: RunAPI;
  team?: Teammate[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!suggestionsVisible(run.status) || !run.suggestions?.length) return null;
  return (
    <section className="settings-card" aria-label="Suggestions for later">
      <h3>Suggestions for later</h3>
      <p>
        Optional ideas from the final auditor, not required fixes or verified
        findings. Nothing was added to your task. Marking reviewed does not
        approve implementation.
      </p>
      {run.suggestions.map((s) => (
        <article key={s.id}>
          <p style={{ whiteSpace: "pre-wrap" }}>{s.text}</p>
          <small>
            {s.actorName ||
              team.find((member) => member.id === s.actor)?.name ||
              s.actor}{" "}
            · snapshot {s.revision.slice(0, 12)}
          </small>
          {run.reviewedSuggestionIds?.includes(s.id) ? (
            <p>Reviewed, not scheduled</p>
          ) : (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api.reviewSuggestion(run.id, s.id);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not record review",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Mark reviewed
            </button>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
