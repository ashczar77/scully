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
  planner: string | null;
  idleCoordinator: string | null;
  builder: string;
  auditor: string;
  tester: string | null;
  reserves: string[];
  requiredRequests: number;
  requestCeiling: number;
  outputTokensPerRequest: number | null;
  rateStatus: "verified" | "stale" | "unknown";
  planningEstimateNanoUsd: number | null;
  phases: {
    id: "planning" | "building" | "testing" | "auditing";
    member: string;
    purpose: string;
    requiredRequests: 1;
  }[];
};

// This describes the current dispatcher. Pearl plans only in Plan first mode.
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
  const builder = team.find((member) => runRole(member) === "builder")!.name;
  const auditor = team.find((member) => runRole(member) === "auditor")!.name;
  const tester =
    team.find((member) => runRole(member) === "tester")?.name || null;
  const pearl = team.find((member) => member.id === "pearl")?.name || null;
  const planner = mode === "plan" ? pearl || builder : null;
  const phases: TeamPreview["phases"] = [
    ...(planner
      ? [
          {
            id: "planning" as const,
            member: planner,
            purpose: "Prepares a plan for your review before building",
            requiredRequests: 1 as const,
          },
        ]
      : []),
    {
      id: "building",
      member: builder,
      purpose: tester
        ? "Builds the implementation and supporting files"
        : "Builds the implementation and writes tests",
      requiredRequests: 1,
    },
    ...(tester
      ? [
          {
            id: "testing" as const,
            member: tester,
            purpose: "Writes tests in an assigned, separate scope",
            requiredRequests: 1 as const,
          },
        ]
      : []),
    {
      id: "auditing",
      member: auditor,
      purpose: "Independently reviews the combined result",
      requiredRequests: 1,
    },
  ];
  return {
    planner,
    idleCoordinator: mode === "work" ? pearl : null,
    builder,
    auditor,
    tester,
    phases,
    reserves: team
      .filter(
        (member) => member.id !== "pearl" && runRole(member) === "reserve",
      )
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
