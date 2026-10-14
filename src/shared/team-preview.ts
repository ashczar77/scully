import type { Teammate } from "./contracts";
import { makeCoordination } from "./coordination";
import {
  emptyCostSettings,
  projectedCostNanoUsd,
  resolveModelRate,
} from "./model-cost";
import type { SessionInfo } from "./runs";
import { runRole } from "./teams";
import { defaultUsagePolicy, requiredCalls } from "./usage-policy";

export type TeamPreview = {
  builder: string;
  auditor: string;
  tester: string | null;
  reserves: string[];
  requiredRequests: number;
  requestCeiling: number;
  outputTokensPerRequest: number | null;
  rateStatus: "verified" | "stale" | "unknown";
  planningEstimateNanoUsd: number | null;
};

// This describes the current dispatcher. A saved reserve is not assigned work.
// The estimate uses the existing token-allowance projection, not a spending cap.
export function previewTeamRun(
  team: readonly Teammate[],
  mode: "plan" | "work",
  session: SessionInfo | null,
  now: Date,
): TeamPreview {
  const coordination = makeCoordination(team);
  const run = { coordination, correction: undefined, redirection: undefined };
  const outputTokens =
    session &&
    Number.isSafeInteger(session.outputTokens) &&
    session.outputTokens >= 512 &&
    session.outputTokens <= 4096
      ? session.outputTokens
      : null;
  const policy = defaultUsagePolicy(
    run,
    mode,
    session?.model || "",
    outputTokens || 2048,
  );
  const model = session?.configured ? session.model : "";
  const rate = resolveModelRate(model, emptyCostSettings, now);
  return {
    builder: team.find((member) => runRole(member) === "builder")!.name,
    auditor: team.find((member) => runRole(member) === "auditor")!.name,
    tester: team.find((member) => runRole(member) === "tester")?.name || null,
    reserves: team
      .filter((member) => runRole(member) === "reserve")
      .map((member) => member.name),
    requiredRequests: requiredCalls(run, mode),
    requestCeiling: policy.requestCeiling,
    outputTokensPerRequest: outputTokens,
    rateStatus:
      rate.rateStatus === "verified"
        ? "verified"
        : rate.rateStatus === "stale"
          ? "stale"
          : "unknown",
    planningEstimateNanoUsd:
      rate.rate && outputTokens
        ? projectedCostNanoUsd(policy.requestCeiling * outputTokens, rate.rate)
        : null,
  };
}
