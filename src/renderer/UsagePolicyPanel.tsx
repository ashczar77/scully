import { useEffect, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run, SessionInfo } from "../shared/runs";
import {
  chooseUsagePolicy,
  defaultUsagePolicy,
  expandsUsage,
  requiredCalls,
  type UsagePolicyChoice,
  type UsagePreset,
} from "../shared/usage-policy";

export function UsagePolicyPanel({
  run,
  mode,
  session,
  api,
  onUpdate,
  compact = false,
  onOpenSettings = () => {},
}: {
  run: Run;
  mode: "plan" | "work";
  session: SessionInfo | null;
  api: DesktopAPI;
  onUpdate: (run: Run) => void;
  compact?: boolean;
  onOpenSettings?: () => void;
}) {
  const current =
    run.usagePolicy ||
    defaultUsagePolicy(
      run,
      mode,
      run.model || session?.model || "",
      run.outputTokens || session?.outputTokens || 2048,
    );
  const [outputTokens, setOutputTokens] = useState(current.outputTokens);
  const [requestCeiling, setRequestCeiling] = useState(current.requestCeiling);
  const [earlyReviews, setEarlyReviews] = useState(current.earlyReviews);
  const [approvedIncrease, setApprovedIncrease] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOutputTokens(current.outputTokens);
    setRequestCeiling(current.requestCeiling);
    setEarlyReviews(current.earlyReviews);
    setApprovedIncrease(false);
  }, [run.usagePolicy, run.id]);
  const stable = ["prepared", "planned", "awaiting_input"].includes(run.status);
  const enabled = stable && !!session?.configured && !busy;
  const minimum = requiredCalls(run, mode);
  const model = current.model || session?.model || "";
  const preview = (choice: UsagePolicyChoice) =>
    chooseUsagePolicy(run, mode, model, choice);
  async function apply(choice: UsagePolicyChoice, approved: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = approved
        ? (await api.reviewUsagePolicy(run.id, choice)).token
        : null;
      onUpdate(await api.configureUsagePolicy(run.id, choice, token));
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Could not save usage settings",
      );
    } finally {
      setBusy(false);
    }
  }
  const custom: UsagePolicyChoice = {
    preset: "custom",
    outputTokens,
    requestCeiling,
    earlyReviews,
  };
  let customIncrease = false;
  try {
    customIncrease = expandsUsage(current, preview(custom));
  } catch {
    /* Form validation appears on save. */
  }
  if (compact)
    return (
      <button className="run-setting-card" onClick={onOpenSettings}>
        <span>Run usage</span>
        <strong>
          {current.outputTokens.toLocaleString()} output tokens per request
        </strong>
        <small>
          {current.requestCeiling} coordinator requests · Change in Settings
        </small>
      </button>
    );
  return (
    <section className="settings-card" aria-label="Run usage policy">
      <h3>Run usage</h3>
      <p>
        Current:{" "}
        {current.preset === "save"
          ? "Save tokens"
          : current.preset === "balanced"
            ? "Balanced"
            : current.preset === "thorough"
              ? "Thorough"
              : "Custom"}
        . {current.outputTokens} maximum output tokens per request;{" "}
        {current.requestCeiling} coordinator requests including planning; early
        writer reviews {current.earlyReviews ? "on" : "off"}.
      </p>
      <p className="muted">
        Pearl: {current.model || model || "configure a session first"}. Other
        teammates use their saved model choices from Settings. Presets keep
        these choices; catalog access and price have not been verified here.
        Specialist consultations and read-only replies require their own
        approval and have separate request limits.
      </p>
      {stable && (
        <>
          <p>
            Choose a preset for future requests. Saving a preset never starts
            work.
          </p>
          <p className="muted">
            This journey needs {minimum} coordinator requests for its required
            stages
            {run.correction ? "." : "; optional early reviews add up to two."}
          </p>
          <div className="choice-grid">
            {(["save", "balanced", "thorough"] as UsagePreset[]).map(
              (preset) => {
                const next = preview({ preset });
                const increase = expandsUsage(current, next);
                const label =
                  preset === "save"
                    ? "Save tokens"
                    : preset === "balanced"
                      ? "Balanced"
                      : "Thorough";
                return (
                  <button
                    key={preset}
                    type="button"
                    className="secondary"
                    disabled={!enabled}
                    onClick={() => apply({ preset }, increase)}
                    aria-label={
                      run.status === "planned" && preset === "save"
                        ? "Save tokens for the rest of this run"
                        : `Apply ${label}`
                    }
                  >
                    <strong>{label}</strong>
                    <br />
                    {next.outputTokens} output tokens per request,{" "}
                    {next.requestCeiling} coordinator requests, early reviews{" "}
                    {next.earlyReviews ? "on" : "off"}
                    {increase ? ". Increases allowance." : "."}
                  </button>
                );
              },
            )}
          </div>
          <details>
            <summary>Custom usage settings</summary>
            <label>
              Maximum output tokens per request
              <input
                type="number"
                min={512}
                max={4096}
                step={1}
                value={outputTokens}
                onChange={(e) => setOutputTokens(Number(e.target.value))}
              />
            </label>
            <label>
              Coordinator request ceiling (minimum{" "}
              {minimum + (earlyReviews ? 2 : 0)})
              <input
                type="number"
                min={minimum + (earlyReviews ? 2 : 0)}
                max={run.correction ? 2 : 16}
                step={1}
                value={requestCeiling}
                onChange={(e) => setRequestCeiling(Number(e.target.value))}
              />
            </label>
            {!run.correction && (
              <label className="consent">
                <input
                  type="checkbox"
                  checked={earlyReviews}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setEarlyReviews(next);
                    if (next)
                      setRequestCeiling((value) =>
                        Math.max(value, minimum + 2),
                      );
                  }}
                />{" "}
                Optional early reviews for both writer chunks
              </label>
            )}
            {customIncrease && (
              <label className="consent">
                <input
                  type="checkbox"
                  checked={approvedIncrease}
                  onChange={(e) => setApprovedIncrease(e.target.checked)}
                />{" "}
                I reviewed the increased request or output allowance.
              </label>
            )}
            <button
              type="button"
              className="secondary"
              disabled={!enabled || (customIncrease && !approvedIncrease)}
              onClick={() => apply(custom, approvedIncrease)}
            >
              Apply Custom
            </button>
          </details>
        </>
      )}
      {!stable && (
        <p className="muted">
          Usage settings are locked during active or completed work. Changes to
          a paused plan apply only to its remaining requests.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
