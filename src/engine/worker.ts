import { executeLoop } from "./loop";
import { executeSpecialist } from "./specialist";
import { nebiusModel } from "./provider";
import type { Run, SessionConfig } from "../shared/runs";
import type { Task, Teammate } from "../shared/contracts";
import { answerQuestion } from "./answer";
import { consultSpecialist } from "./consult";
import { trackedModel } from "./usage-tracking";
const port = process.parentPort;
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
    };
  }) => {
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
      config: SessionConfig;
      outputRoot: string;
    };
  }) => {
    try {
      activeConfig = data.config;
      const provider = nebiusModel(data.config);
      const model = trackedModel(
        provider,
        data.config,
        (message) => port.postMessage(message),
        waitForAck,
        (metric) => port.postMessage({ metric }),
      );
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
          );
      port.postMessage({ run: result, done: true });
    } catch {
      port.postMessage({ failed: true });
    }
  },
);
