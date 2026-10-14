import type { Run } from "./runs";

export type UsagePreset = "save" | "balanced" | "thorough" | "custom";
export type UsagePolicy = {
  preset: UsagePreset;
  model: string;
  outputTokens: number;
  requestCeiling: number;
  earlyReviews: boolean;
};
export type UsagePolicyChoice = {
  preset: UsagePreset;
  outputTokens?: number;
  requestCeiling?: number;
  earlyReviews?: boolean;
};

export function requiredCalls(
  run: Pick<Run, "correction" | "redirection"> &
    Partial<Pick<Run, "coordination">>,
  mode: "plan" | "work",
) {
  if (run.correction) return 2;
  const writers = run.coordination?.assignments.length || 2;
  return writers + 1 + (mode === "plan" || run.redirection ? 1 : 0);
}

export function chooseUsagePolicy(
  run: Pick<Run, "correction" | "redirection"> &
    Partial<Pick<Run, "coordination">>,
  mode: "plan" | "work",
  model: string,
  value: unknown,
): UsagePolicy {
  if (!value || typeof value !== "object")
    throw new Error("Invalid usage policy");
  const input = value as UsagePolicyChoice;
  const minimum = requiredCalls(run, mode);
  const earlyReviewCalls = run.coordination?.assignments.length || 2;
  const correction = !!run.correction;
  let outputTokens: number;
  let requestCeiling: number;
  let earlyReviews: boolean;
  switch (input.preset) {
    case "save":
      outputTokens = 1024;
      requestCeiling = minimum;
      earlyReviews = false;
      break;
    case "balanced":
      outputTokens = 2048;
      requestCeiling = correction
        ? 2
        : earlyReviewCalls === 1
          ? minimum
          : Math.max(4, minimum);
      earlyReviews = false;
      break;
    case "thorough":
      outputTokens = 4096;
      requestCeiling = minimum + (correction ? 0 : earlyReviewCalls);
      earlyReviews = !correction;
      break;
    case "custom":
      outputTokens = input.outputTokens as number;
      requestCeiling = input.requestCeiling as number;
      earlyReviews = input.earlyReviews as boolean;
      break;
    default:
      throw new Error("Unknown usage preset");
  }
  if (
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 512 ||
    outputTokens > 4096 ||
    !Number.isSafeInteger(requestCeiling) ||
    requestCeiling < minimum + (earlyReviews ? earlyReviewCalls : 0) ||
    requestCeiling > (correction ? 2 : 6) ||
    typeof earlyReviews !== "boolean" ||
    (correction && earlyReviews)
  )
    throw new Error("Usage policy is below required calls or outside limits");
  return {
    preset: input.preset,
    model,
    outputTokens,
    requestCeiling,
    earlyReviews,
  };
}

export function defaultUsagePolicy(
  run: Pick<Run, "correction" | "redirection" | "coordination">,
  mode: "plan" | "work",
  model: string,
  outputTokens: number,
): UsagePolicy {
  const minimum = requiredCalls(run, mode);
  const writers = run.coordination?.assignments.length || 2;
  const earlyReviews =
    !!run.coordination?.settings?.chunkReviews && !run.correction;
  return {
    preset: outputTokens === 2048 && !earlyReviews ? "balanced" : "custom",
    model,
    outputTokens,
    requestCeiling: run.correction
      ? 2
      : earlyReviews
        ? minimum + writers
        : writers === 1
          ? minimum
          : Math.max(4, minimum),
    earlyReviews,
  };
}

export function expandsUsage(old: UsagePolicy, next: UsagePolicy) {
  return (
    next.outputTokens > old.outputTokens ||
    next.requestCeiling > old.requestCeiling ||
    (next.earlyReviews && !old.earlyReviews) ||
    (old.model !== "" && next.model !== old.model)
  );
}
