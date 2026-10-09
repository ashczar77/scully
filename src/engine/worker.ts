import { executeLoop } from "./loop";
import { executeSpecialist } from "./specialist";
import { nebiusModel } from "./provider";
import type { Run, SessionConfig } from "../shared/runs";
import type { Task, Teammate } from "../shared/contracts";
import { measured } from "../shared/telemetry";
import { answerQuestion } from "./answer";
const port = process.parentPort;
port.once(
  "message",
  async ({
    data,
  }: {
    data: {
      replyContext?: string;
      specialist?: boolean;
      run: Run;
      task: Task;
      team: Teammate[];
      config: SessionConfig;
      outputRoot: string;
    };
  }) => {
    try {
      const provider = nebiusModel(data.config);
      const model = {
        complete: (request: import("./provider").Completion) =>
          measured(
            "model.request",
            () => provider.complete(request),
            (metric) => port.postMessage({ metric }),
          ),
      };
      if (data.replyContext !== undefined) {
        port.postMessage({
          answer: await answerQuestion(data.replyContext, model),
        });
        return;
      }
      const result = data.specialist
        ? await executeSpecialist(data.run, data.task, model, (run) =>
            port.postMessage({ run }),
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
