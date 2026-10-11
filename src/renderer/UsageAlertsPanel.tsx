import { useEffect, useState } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import {
  defaultUsageAlertPolicy,
  type UsageAlertPolicy,
  type UsageAlertSnapshot,
} from "../shared/usage-alerts";
import type { UsageSnapshot } from "../shared/usage";

export function UsageAlertsPanel({
  run,
  usage,
  api,
  onSaveTokens,
  onStop,
}: {
  run: Run;
  usage: UsageSnapshot | null;
  api: DesktopAPI;
  onSaveTokens: () => void;
  onStop: () => void;
}) {
  const [snapshot, setSnapshot] = useState<UsageAlertSnapshot | null>(null);
  const [draft, setDraft] = useState<UsageAlertPolicy>(defaultUsageAlertPolicy);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api
      .usageAlertsForRun(run.id)
      .then((value) => {
        if (current) {
          setSnapshot(value);
          setDraft(value.policy);
        }
      })
      .catch(() => {
        if (current) setError("Usage alerts are unavailable.");
      });
    return () => {
      current = false;
    };
  }, [api, run.id, run]);
  const policy = snapshot?.policy || defaultUsageAlertPolicy;
  const measured = usage ? usage.inputTokens + usage.outputTokens : 0;
  const reserved =
    snapshot?.reservedTokens ??
    (usage ? usage.pending * policy.requestAllowanceTokens : 0);
  const set = (value: Partial<UsageAlertPolicy>) =>
    setDraft((current) => ({ ...current, ...value }));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const value = await api.configureUsageAlerts(run.id, draft);
      setSnapshot(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save usage alerts.");
    } finally {
      setBusy(false);
    }
  }
  async function continueOnce() {
    if (!snapshot?.state.pauseId) return;
    setBusy(true);
    setError("");
    try {
      setSnapshot(await api.continueUsage(run.id, snapshot.state.pauseId));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not continue this request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" aria-label="Usage alerts and pauses">
      <h3>Usage alerts and pauses</h3>
      <p>
        {measured.toLocaleString()} reported tokens; {reserved.toLocaleString()}{" "}
        reserved for {usage?.pending || 0} pending requests.
        {usage?.unknown
          ? ` ${usage.unknown} requests have unknown usage.`
          : ""}{" "}
        Budget: {policy.budgetTokens.toLocaleString()} tokens.
      </p>
      <p className="muted">
        The allowance reserves {policy.requestAllowanceTokens.toLocaleString()}{" "}
        tokens for each request before dispatch. Input usage can exceed that
        estimate. This controls the next request, not an exact token or currency
        cap.
      </p>
      {snapshot?.state.latest && (
        <p role="alert" className="attention">
          {snapshot.state.latest.text}
          {snapshot.state.pauseId
            ? " The next model request has not been sent."
            : ""}
        </p>
      )}
      {!!snapshot?.state.recent.length && (
        <details>
          <summary>
            Recent usage alerts ({snapshot.state.recent.length})
          </summary>
          <ul>
            {snapshot.state.recent.map((item) => (
              <li key={item.sequence}>{item.text}</li>
            ))}
          </ul>
        </details>
      )}
      {snapshot?.state.pauseId && snapshot.waiting && (
        <div className="choice-grid">
          <button type="button" disabled={busy} onClick={continueOnce}>
            Continue once
          </button>
          {["planning", "building"].includes(run.status) && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onSaveTokens}
            >
              Lower future usage
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
        </div>
      )}
      {snapshot?.state.pauseId && !snapshot.waiting && (
        <p className="muted">
          The pause is saved for review. No held request will restart
          automatically.
        </p>
      )}
      <details>
        <summary>Configure usage alerts</summary>
        <label>
          Run token budget
          <input
            type="number"
            min={1000}
            max={1000000}
            value={draft.budgetTokens}
            onChange={(e) => set({ budgetTokens: Number(e.target.value) })}
          />
        </label>
        <label>
          Allowance reserved per request
          <input
            type="number"
            min={512}
            max={200000}
            value={draft.requestAllowanceTokens}
            onChange={(e) =>
              set({ requestAllowanceTokens: Number(e.target.value) })
            }
          />
        </label>
        <label>
          First warning (%)
          <input
            type="number"
            min={1}
            max={98}
            value={draft.warnings[0]}
            onChange={(e) =>
              set({ warnings: [Number(e.target.value), draft.warnings[1]] })
            }
          />
        </label>
        <label>
          Second warning (%)
          <input
            type="number"
            min={2}
            max={99}
            value={draft.warnings[1]}
            onChange={(e) =>
              set({ warnings: [draft.warnings[0], Number(e.target.value)] })
            }
          />
        </label>
        <label>
          Per-request spike warning (reported tokens)
          <input
            type="number"
            min={1}
            max={200000}
            value={draft.spikeTokens}
            onChange={(e) => set({ spikeTokens: Number(e.target.value) })}
          />
        </label>
        <label>
          Repeat threshold warning every N requests (0 disables)
          <input
            type="number"
            min={0}
            max={64}
            value={draft.repeatEveryRequests}
            onChange={(e) =>
              set({ repeatEveryRequests: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Spike and repeat cooldown (minutes)
          <input
            type="number"
            min={0}
            max={1440}
            value={draft.cooldownMinutes}
            onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          At the budget or unknown usage
          <select
            value={draft.mode}
            onChange={(e) =>
              set({ mode: e.target.value as UsageAlertPolicy["mode"] })
            }
          >
            <option value="pause">Pause before the next request</option>
            <option value="warn">Warn only; keep fixed request limits</option>
          </select>
        </label>
        <label>
          Delivery
          <select
            value={draft.delivery}
            onChange={(e) =>
              set({ delivery: e.target.value as UsageAlertPolicy["delivery"] })
            }
          >
            <option value="in_app">In-app only</option>
            <option value="desktop">In-app and desktop notification</option>
          </select>
        </label>
        <p className="muted">
          Desktop notifications are local and require this explicit choice. They
          contain no task content. If the operating system blocks them, the
          in-app alert remains.
        </p>
        <button type="button" disabled={busy} onClick={save}>
          Save alert settings
        </button>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
