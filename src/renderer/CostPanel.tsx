import { useEffect, useState, type FormEvent } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";
import type { CostSnapshot, ModelRate } from "../shared/model-cost";

const money = (nano: number) =>
  nano > 0 && nano < 1000
    ? "<$0.000001"
    : `$${(nano / 1_000_000_000).toFixed(6)}`;
const rateMoney = (milli: number) => `$${(milli / 1000).toFixed(3)}`;

export function CostPanel({
  run,
  api,
  compact = false,
  onOpenSettings = () => {},
}: {
  run: Run;
  api: DesktopAPI;
  compact?: boolean;
  onOpenSettings?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<CostSnapshot | null>(null);
  const [budget, setBudget] = useState("");
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [checked, setChecked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = (value: CostSnapshot) => {
    setSnapshot(value);
    setBudget(
      value.settings.budgetCents === null
        ? ""
        : (value.settings.budgetCents / 100).toFixed(2),
    );
    setManual(!!value.settings.manualRate);
    setInput(
      value.settings.manualRate
        ? rateMoney(value.settings.manualRate.inputMilliUsdPerMillion).slice(1)
        : "",
    );
    setOutput(
      value.settings.manualRate
        ? rateMoney(value.settings.manualRate.outputMilliUsdPerMillion).slice(1)
        : "",
    );
    setChecked(
      value.settings.manualRate?.checkedAt ||
        new Date().toISOString().slice(0, 10),
    );
  };
  useEffect(() => {
    let current = true;
    api
      .costForRun(run.id)
      .then((value) => {
        if (current) accept(value);
      })
      .catch(() => {
        if (current) setError("Model cost information is unavailable.");
      });
    return () => {
      current = false;
    };
  }, [api, run]);
  const parseMoney = (value: string, decimals: number) => {
    if (!/^\d+(?:\.\d{1,3})?$/.test(value))
      throw new Error(
        "Enter a nonnegative USD amount with at most three decimals.",
      );
    return Math.round(Number(value) * decimals);
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    setError("");
    try {
      if (budget && !/^\d+(?:\.\d{1,2})?$/.test(budget))
        throw new Error("Enter a USD budget with at most two decimals.");
      const budgetCents = budget ? parseMoney(budget, 100) : null;
      const manualRate: ModelRate | null = manual
        ? {
            model: snapshot.model,
            inputMilliUsdPerMillion: parseMoney(input, 1000),
            outputMilliUsdPerMillion: parseMoney(output, 1000),
            checkedAt: checked,
            source: "user_supplied",
            sourceUrl: null,
          }
        : null;
      accept(await api.configureCost(run.id, { budgetCents, manualRate }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save cost settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  const totals = snapshot?.totals;
  const incomplete =
    !!totals &&
    (totals.unpricedMeasured > 0 ||
      totals.unknownUsage > 0 ||
      totals.unpricedPending > 0);
  if (compact)
    return (
      <button className="run-setting-card" onClick={onOpenSettings}>
        <span>Model cost estimates</span>
        <strong>
          {snapshot?.settings.budgetCents == null
            ? "USD warning budget off"
            : `$${(snapshot.settings.budgetCents / 100).toFixed(2)} USD warning budget`}
        </strong>
        <small>
          {snapshot?.rateStatus === "verified"
            ? "Published Pearl model rate"
            : snapshot?.rateStatus === "user_estimate"
              ? "User supplied Pearl rate"
              : "Pearl model rate unknown"}{" "}
          · Change in Settings
        </small>
      </button>
    );
  return (
    <section className="settings-card" aria-label="Model cost estimates">
      <h3>Model cost estimates</h3>
      {snapshot && (
        <>
          <p>
            Pearl model: {snapshot.model || "not configured"}. Rate:{" "}
            {snapshot.rateStatus === "verified"
              ? "Nebius published listing"
              : snapshot.rateStatus === "user_estimate"
                ? "user supplied estimate"
                : snapshot.rateStatus === "stale"
                  ? "stale, cost unknown"
                  : "unknown"}
            .
            {snapshot.referenceRate && (
              <>
                {" "}
                Checked {snapshot.referenceRate.checkedAt}:{" "}
                {rateMoney(snapshot.referenceRate.inputMilliUsdPerMillion)}{" "}
                input and{" "}
                {rateMoney(snapshot.referenceRate.outputMilliUsdPerMillion)}{" "}
                output per million tokens.
                {snapshot.referenceRate.sourceUrl && (
                  <>
                    {" "}
                    Source: <code>{snapshot.referenceRate.sourceUrl}</code>.
                  </>
                )}
              </>
            )}
          </p>
          <p>
            {money(totals!.verifiedNanoUsd)} calculated from reported tokens and
            a saved Nebius listing; {money(totals!.estimatedNanoUsd)} using user
            supplied rates. {money(totals!.pendingProjectedNanoUsd)} reserved
            projection for pending requests.
            {incomplete &&
              ` Partial total: ${totals!.unpricedMeasured} measured requests lack a usable price, ${totals!.unknownUsage} requests have unknown usage, and ${totals!.unpricedPending} pending requests lack a usable price. Their cost is unknown.`}
          </p>
          <p>
            Next Pearl request projection:{" "}
            {snapshot.nextProjectedNanoUsd === null
              ? "unknown"
              : money(snapshot.nextProjectedNanoUsd)}
            .{" "}
            {snapshot.settings.budgetCents === null
              ? "No USD warning budget set."
              : `USD warning budget: $${(snapshot.settings.budgetCents / 100).toFixed(2)}.`}
          </p>
          <p className="muted">
            Projections reserve the token allowance at the higher input or
            output rate. Other teammates may use different models. Their rates
            are assessed when they make requests, and their costs are included
            in the totals above. Actual input can exceed that allowance. These
            are local estimates, not provider charges or an account spending
            cap. Scully does not check account balances or make automatic top
            ups.
          </p>
          <h4>Other service costs</h4>
          <p>
            Nebius Sandboxes: {run.cloudExecutions?.length || 0} check attempts
            recorded for this run. Their dollar cost is unknown and is not
            included in this model-only USD budget. Check the Token Factory
            Organisation Usage page for billed service spending.
          </p>
          <p>
            Tavily: not connected in this build. Scully makes no Tavily
            requests. If connected later, credits and plan-specific charges will
            need separate tracking.
          </p>
          <form onSubmit={save}>
            <label>
              USD warning budget{" "}
              <input
                aria-label="USD warning budget"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="No budget"
                inputMode="decimal"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />{" "}
              Use a user supplied rate for this exact model
            </label>
            {manual && (
              <>
                <label>
                  Input USD per million tokens{" "}
                  <input
                    aria-label="Input USD per million tokens"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  Output USD per million tokens{" "}
                  <input
                    aria-label="Output USD per million tokens"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  Rate checked date{" "}
                  <input
                    aria-label="Rate checked date"
                    type="date"
                    value={checked}
                    onChange={(e) => setChecked(e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            <button disabled={busy}>Save cost settings</button>
          </form>
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
