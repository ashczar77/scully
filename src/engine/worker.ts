import { executeLoop } from "./loop";
import { executeSpecialist } from "./specialist";
import { nebiusModel } from "./provider";
import type { Run, SessionConfig } from "../shared/runs";
import type { Task, Teammate } from "../shared/contracts";
import { answerQuestion } from "./answer";
import { consultSpecialist } from "./consult";
import { trackedModel } from "./usage-tracking";
import { modelForActor } from "../shared/role-models";
import { RequestPauseGate } from "./request-pause";
import { writeFileSync } from "node:fs";
const port = process.parentPort;
const pauseGate = new RequestPauseGate((id) =>
  port.postMessage({ pauseReached: id }),
);
const acknowledgments = new Map<
  string,
  { resolve: () => void; reject: () => void }
>();
let activeConfig: SessionConfig | null = null;
port.on(
  "message",
  ({
    data,
  }: {
    data: {
      usageAcknowledged?: unknown;
      usageRejected?: unknown;
      usageOutputTokens?: unknown;
      pauseRequested?: unknown;
      resumePause?: unknown;
    };
  }) => {
    if (typeof data?.pauseRequested === "string") {
      try {
        pauseGate.request(data.pauseRequested);
      } catch {
        /* The privileged manager rejects duplicate pause requests. */
      }
    }
    if (typeof data?.resumePause === "string") {
      try {
        pauseGate.resume(data.resumePause);
        port.postMessage({ pauseReleased: data.resumePause });
      } catch {
        /* A stale resume cannot release the current pause. */
      }
    }
    if (
      Number.isSafeInteger(data?.usageOutputTokens) &&
      (data.usageOutputTokens as number) >= 512 &&
      activeConfig &&
      (data.usageOutputTokens as number) <= activeConfig.outputTokens
    ) {
      activeConfig.outputTokens = data.usageOutputTokens as number;
      port.postMessage({ usageLimitApplied: activeConfig.outputTokens });
    }
    if (typeof data?.usageRejected === "string")
      acknowledgments.get(data.usageRejected)?.reject();
    if (typeof data?.usageAcknowledged === "string")
      acknowledgments.get(data.usageAcknowledged)?.resolve();
  },
);
function waitForAck(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        acknowledgments.delete(id);
        reject(
          new Error(
            "Usage record was not confirmed; model request was not sent",
          ),
        );
      },
      30 * 60 * 1000,
    );
    acknowledgments.set(id, {
      resolve: () => {
        clearTimeout(timer);
        acknowledgments.delete(id);
        resolve();
      },
      reject: () => {
        clearTimeout(timer);
        acknowledgments.delete(id);
        reject(new Error("Model request was rejected before dispatch"));
      },
    });
  });
}
port.once(
  "message",
  async ({
    data,
  }: {
    data: {
      replyContext?: string;
      consultContext?: string;
      specialist?: boolean;
      run: Run;
      task: Task;
      team: Teammate[];
      config: SessionConfig & { planningTemperature?: number };
      outputRoot: string;
      rawCapturePath?: string;
    };
  }) => {
    try {
      activeConfig = data.config;
      let captured = false;
      const provider = nebiusModel(
        data.config,
        fetch,
        data.rawCapturePath
          ? (value) => {
              if (captured) return;
              captured = true;
              try {
                writeFileSync(data.rawCapturePath!, JSON.stringify(value), {
                  flag: "wx",
                  mode: 0o600,
                });
                port.postMessage({ rawCaptureSaved: true });
              } catch {
                port.postMessage({ rawCaptureFailed: true });
              }
            }
          : undefined,
      );
      const tracked = trackedModel(
        provider,
        data.config,
        (message) => port.postMessage(message),
        waitForAck,
        (metric) => port.postMessage({ metric }),
      );
      const model = {
        complete: (request: import("./provider").Completion) =>
          tracked.complete({
            ...request,
            model: modelForActor(
              data.run?.roleModels,
              request.actor,
              data.team || [],
              data.config.model,
            ),
          }),
      };
      if (data.replyContext !== undefined) {
        port.postMessage({
          answer: await answerQuestion(data.replyContext, model, () =>
            port.postMessage({ replyStarted: true }),
          ),
        });
        return;
      }
      if (data.consultContext !== undefined) {
        port.postMessage({
          consultationResult: await consultSpecialist(
            data.consultContext,
            model,
            () => port.postMessage({ consultationStarted: true }),
          ),
        });
        return;
      }
      const result = data.specialist
        ? await executeSpecialist(
            data.run,
            data.task,
            model,
            (run) => port.postMessage({ run }),
            data.team,
          )
        : await executeLoop(
            data.run,
            data.task,
            data.team,
            model,
            data.outputRoot,
            (run) => port.postMessage({ run }),
            pauseGate,
          );
      port.postMessage({ run: result, done: true });
    } catch {
      port.postMessage({ failed: true });
    }
  },
);
