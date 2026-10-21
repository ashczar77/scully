import type { PearlModel } from "../engine/pearl-model";

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
