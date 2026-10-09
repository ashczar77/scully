import { randomUUID } from "node:crypto";
import type { InFlightRequest, Run } from "../shared/runs";

export async function whileRequest<T>(
  run: Run,
  actor: InFlightRequest["actor"],
  name: InFlightRequest["name"],
  execute: () => Promise<T>,
  emit: (run: Run) => void,
): Promise<T> {
  const id = randomUUID();
  run.inFlightRequests ||= [];
  run.inFlightRequests.push({
    id,
    actor,
    name,
    startedAt: new Date().toISOString(),
  });
  emit(structuredClone(run));
  try {
    return await execute();
  } finally {
    run.inFlightRequests = (run.inFlightRequests || []).filter(
      (request) => request.id !== id,
    );
    emit(structuredClone(run));
  }
}
