import type { Teammate } from "../shared/contracts";
import type { SessionInfo } from "../shared/runs";
import { previewTeamRun } from "../shared/team-preview";

export function TeamPreview({
  team,
  mode,
  session,
  context = "task",
}: {
  team: Teammate[];
  mode: "plan" | "work";
  session: SessionInfo | null;
  context?: "task" | "team";
}) {
  const preview = previewTeamRun(team, mode, session, new Date());
  return (
    <section className="team-preview" aria-label="Team and cost preview">
      <h3>Team and cost preview</h3>
      <p>
        {preview.builder} builds
        {preview.tester
          ? `, ${preview.tester} writes tests`
          : " and writes tests"}
        ; {preview.auditor} reviews the combined result.
      </p>
      {preview.reserves.length > 0 && (
        <p className="team-preview-notice">
          {preview.reserves.join(", ")}{" "}
          {preview.reserves.length === 1
            ? "is on the team but receives"
            : "are on the team but receive"}{" "}
          no automatic work or model requests.
          {context === "task" &&
            " Consider removing unused members before saving this task."}
        </p>
      )}
      <p>
        {preview.requiredRequests} required model requests, up to{" "}
        {preview.requestCeiling} under default run settings
        {preview.outputTokensPerRequest === null
          ? ". Output token limit is unavailable."
          : `, with up to ${preview.outputTokensPerRequest.toLocaleString()} output tokens per request.`}
      </p>
      <p>
        Model cost planning estimate:{" "}
        {preview.planningEstimateNanoUsd === null
          ? "unknown"
          : `$${(preview.planningEstimateNanoUsd / 1_000_000_000).toFixed(6)}`}
        {preview.rateStatus === "verified"
          ? " using a current bundled model rate."
          : preview.rateStatus === "stale"
            ? " because the bundled rate is stale."
            : " because the model rate is unavailable."}
      </p>
      <p className="muted">
        This estimate reserves the output token allowance at the higher
        published rate. Input size is unknown and can raise actual cost. It
        excludes Sandbox and other service charges. This is neither a provider
        quote nor a spending cap.
      </p>
      <p className="muted">
        {context === "task"
          ? "This task has not been split into independent work packages, so Scully cannot yet say whether another builder or tester would help."
          : "A future task may need more or fewer people, but this preview has no task scope to assess."}{" "}
        The current dispatcher assigns at most one of each role.
      </p>
    </section>
  );
}
