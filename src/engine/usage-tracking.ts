import { randomUUID } from "node:crypto";
import type { Completion, Model } from "./provider";
import type { ReportedUsage } from "../shared/usage";
import { measured, type MetricSink } from "../shared/telemetry";

export function trackedModel(
  provider: Model,
  config: { model: string; outputTokens: number },
  emit: (message: unknown) => void,
  waitForAck: (id: string) => Promise<void>,
  metricSink: MetricSink,
): Model {
  return {
    async complete(request: Completion) {
      const id = randomUUID();
      const maxOutputTokens = request.maxOutputTokens ?? config.outputTokens;
      const selectedModel = request.model || config.model;
      let usage: ReportedUsage | null = null;
      const acknowledged = waitForAck(id);
      emit({
        usageStart: {
          id,
          stage: request.name,
          model: selectedModel,
          ...(request.actor && { actor: request.actor }),
          maxOutputTokens,
        },
      });
      await acknowledged;
      try {
        return await measured(
          "model.request",
          () =>
            provider.complete({
              ...request,
              maxOutputTokens,
              onUsage: (value) => {
                usage = value;
                try {
                  request.onUsage?.(value);
                } catch {
                  // Observers cannot change a model request result.
                }
              },
              onDiagnostic: (value) => {
                emit({ requestDiagnostic: value });
                try {
                  request.onDiagnostic?.(value);
                } catch {
                  // Observers cannot change a model request result.
                }
              },
            }),
          metricSink,
        );
      } finally {
        emit({ usageFinish: { id, usage } });
      }
    },
  };
}
