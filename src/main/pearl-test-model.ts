import type { PearlModel } from "../engine/pearl-model";

export function liveModelRequestLimit(value: string | undefined): number {
  const requested = Number(value ?? 18);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(24, requested)
    : 18;
}

export function cappedPearlModel(model: PearlModel, limit: number): PearlModel {
  let requests = 0;
  return {
    complete(input) {
      if (requests >= limit)
        throw new Error(
          "Live test request budget exhausted; saved work can be continued",
        );
      requests++;
      return model.complete(input);
    },
  };
}
