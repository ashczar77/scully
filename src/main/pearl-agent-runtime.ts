import { createHash } from "node:crypto";
import type { PearlModelResult } from "../engine/pearl-model";
import type {
  PearlChat,
  PearlProviderContinuation,
  PearlPauseReason,
  PearlToolCall,
} from "../shared/pearl-chat";

export type ActionDisposition = "continue" | "paused" | "finished";

export type PearlAgentHost = {
  load: () => PearlChat;
  allowedTools: (chat: PearlChat) => string[];
  request: (
    chat: PearlChat,
    allowedTools: string[],
    signal: AbortSignal,
    suffix?: string,
  ) => Promise<PearlModelResult>;
  recordActions: (
    chat: PearlChat,
    calls: PearlToolCall[],
    text: string,
    continuation?: PearlProviderContinuation,
    fallbackModel?: string,
  ) => void;
  observe: (chat: PearlChat, call: PearlToolCall, observation: string) => void;
  execute: (chat: PearlChat, call: PearlToolCall) => Promise<ActionDisposition>;
  finish: (chat: PearlChat, text: string, fallbackModel?: string) => void;
  pause: (
    chat: PearlChat,
    reason: string,
    kind: PearlPauseReason,
    draft?: string,
  ) => void;
  needsCheck: (chat: PearlChat) => boolean;
  needsBrowserCheck?: (chat: PearlChat) => boolean;
  needsCompletion: (chat: PearlChat) => boolean;
};

const softStepLimit = 32;
const checkpointInterval = 16;
const progressWindowSize = 8;
const defaultHardStepLimit = 128;
const defaultTimeBudgetMs = 15 * 60 * 1000;

export type AgentRunLimits = {
  hardStepLimit?: number;
  timeBudgetMs?: number;
  now?: () => number;
};

function failedObservation(value: string | undefined): boolean {
  if (value) {
    try {
      const result = JSON.parse(value);
      if (result.error || ("exitCode" in result && result.exitCode !== 0))
        return true;
      if (Array.isArray(result.errors) && result.errors.length) return true;
    } catch {
      /* Text observations are checked below. */
    }
  }
  return (
    !value ||
    /^(Action (failed|rejected|not applied)|Question rejected|Withdrawal rejected|Answer link rejected|Completion rejected|Invalid )/u.test(
      value,
    )
  );
}

function canonicalArguments(value: string): unknown {
  try {
    const normalize = (item: unknown): unknown =>
      Array.isArray(item)
        ? item.map(normalize)
        : item && typeof item === "object"
          ? Object.fromEntries(
              Object.entries(item)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, normalize(child)]),
            )
          : item;
    return normalize(JSON.parse(value));
  } catch {
    return value;
  }
}

function cycleFingerprint(
  calls: PearlToolCall[],
  observations: (string | undefined)[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        calls.map((call, index) => [
          call.name,
          canonicalArguments(call.arguments),
          observations[index],
        ]),
      ),
    )
    .digest("hex");
}

function successfulWrite(
  call: PearlToolCall,
  observation: string | undefined,
): boolean {
  if (
    !observation ||
    ![
      "create_file",
      "write_file",
      "replace_in_file",
      "apply_patch",
      "edit_files",
    ].includes(call.name)
  )
    return false;
  try {
    return JSON.parse(observation).written === true;
  } catch {
    return false;
  }
}

const controlActions = new Set([
  "mcp_call_tool",
  "edit_files",
  "run_command",
  "sandbox_run_check",
  "start_terminal",
  "preview_app",
  "ask_user",
  "answer_question",
  "withdraw_question",
  "complete_work",
]);

function validateBatch(calls: PearlToolCall[]): void {
  if (calls.length < 1 || calls.length > 8)
    throw new Error("Invalid number of proposed actions");
  const ids = new Set<string>();
  for (const call of calls) {
    if (
      !call.id ||
      ids.has(call.id) ||
      !/^[a-z][a-z_]{0,40}$/.test(call.name) ||
      typeof call.arguments !== "string" ||
      call.arguments.length > 1_100_000
    )
      throw new Error("Invalid proposed action");
    ids.add(call.id);
  }
}

export async function runPearlAgentTurn(
  host: PearlAgentHost,
  signal: AbortSignal,
  limits: AgentRunLimits = {},
): Promise<void> {
  const hardStepLimit = limits.hardStepLimit ?? defaultHardStepLimit;
  const timeBudgetMs = limits.timeBudgetMs ?? defaultTimeBudgetMs;
  const now = limits.now ?? Date.now;
  const started = now();
  let verificationRequested = false;
  let browserRequested = false;
  let completionRequested = false;
  let repetitionNudge = "";
  const seenCycles = new Map<string, number>();
  const recentProgress: boolean[] = [];
  const saved = host.load();
  const start = saved.messages.findIndex(
    (message) => message.id === saved.activeUserMessageId,
  );
  if (start >= 0) {
    for (const message of saved.messages.slice(start + 1)) {
      if (message.role !== "assistant") continue;
      const calls =
        message.toolCalls ||
        (message.toolCallId && message.toolName
          ? [
              {
                id: message.toolCallId,
                name: message.toolName,
                arguments: message.arguments || "{}",
              },
            ]
          : []);
      if (!calls.length) continue;
      const observations = calls.map(
        (call) =>
          saved.messages.find(
            (item) => item.role === "tool" && item.toolCallId === call.id,
          )?.text,
      );
      if (observations.some((value) => value === undefined)) continue;
      if (
        calls.some((call, index) => successfulWrite(call, observations[index]))
      )
        seenCycles.clear();
      for (const [index, call] of calls.entries()) {
        const fingerprint = cycleFingerprint([call], [observations[index]]);
        seenCycles.set(fingerprint, (seenCycles.get(fingerprint) || 0) + 1);
      }
    }
    if ([...seenCycles.values()].some((count) => count >= 3))
      repetitionNudge =
        "\nAn action already repeated without new results before this continuation. Use a different approach or explain the blocker.";
  }
  const inspectCycle = (calls: PearlToolCall[]): boolean => {
    const chat = host.load();
    const observations = calls.map(
      (call) =>
        [...chat.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "tool" && message.toolCallId === call.id,
          )?.text,
    );
    if (
      calls.some((call, index) => successfulWrite(call, observations[index]))
    ) {
      seenCycles.clear();
      verificationRequested = false;
      browserRequested = false;
      completionRequested = false;
    }
    const counts = calls.map((call, index) => {
      const fingerprint = cycleFingerprint([call], [observations[index]]);
      const count = (seenCycles.get(fingerprint) || 0) + 1;
      seenCycles.set(fingerprint, count);
      return count;
    });
    const count = Math.min(...counts);
    const progressed = observations.some(
      (value, index) => counts[index] === 1 && !failedObservation(value),
    );
    recentProgress.push(progressed);
    if (recentProgress.length > progressWindowSize) recentProgress.shift();
    if (count === 3)
      repetitionNudge =
        "\nThe same action produced the same result three times. Repeating it again will not add information. Use a different approach or explain what is blocking progress.";
    if (count < 4) return false;
    host.pause(
      chat,
      "Pearl repeated the same action and result. Review the recorded work, then Continue with a different approach or send a new instruction.",
      "repeated_action",
    );
    return true;
  };
  for (let step = 0; step < hardStepLimit; step++) {
    if (signal.aborted) throw new Error("Stopped by user");
    if (step > 0 && now() - started >= timeBudgetMs) {
      host.pause(
        host.load(),
        "Pearl reached the time budget for one stretch of work. The actions are saved. Continue to keep working or give a new instruction.",
        "time_budget",
      );
      return;
    }
    const chat = host.load();
    const allowed = host.allowedTools(chat);
    const suffix =
      (verificationRequested && host.needsCheck(chat)
        ? "\nFiles changed after the latest successful command check. Request a relevant check through run_command before concluding if one is available. If you cannot check, clearly state that the edits are unverified. Do not claim the task is complete based only on file writes."
        : "") +
      (browserRequested && host.needsBrowserCheck?.(chat)
        ? "\nBrowser verification is missing, failed, or predates an edit. Use browser_check for static HTML or preview_app for the running application and inspect rendered behavior, errors, and hidden-state violations before concluding. If the browser check is unavailable or fails, report the UI as unverified."
        : "") +
      (completionRequested && host.needsCompletion(chat)
        ? "\nProject files changed in this turn. Call complete_work with a status and summary to finish. State unfinished work and use unverified when no successful check followed the latest edit. Do not finish with plain text."
        : "") +
      repetitionNudge;
    repetitionNudge = "";
    const result = await host.request(
      chat,
      allowed,
      signal,
      suffix || undefined,
    );
    if (signal.aborted) throw new Error("Stopped by user");
    if (result.kind === "reply") {
      if (!verificationRequested && host.needsCheck(chat)) {
        verificationRequested = true;
        continue;
      }
      if (!browserRequested && host.needsBrowserCheck?.(chat)) {
        browserRequested = true;
        continue;
      }
      if (host.needsCompletion(chat)) {
        if (!completionRequested) {
          completionRequested = true;
          continue;
        }
        host.pause(
          chat,
          "Pearl's remote file edits and check results are saved. Her draft reply was not a completion record, so the task paused before marking it done. Continue asks Pearl to finish from the saved checkpoint, or send a new instruction.",
          "completion_missing",
          result.text,
        );
        return;
      }
      host.finish(chat, result.text, result.fallbackModel);
      return;
    }
    const calls = result.kind === "tool" ? [result.call] : result.calls;
    validateBatch(calls);
    host.recordActions(
      chat,
      calls,
      result.text,
      result.providerContinuation,
      result.fallbackModel,
    );

    // A plan is local working state, not authority. It can be saved immediately
    // before a final decision action. No file work may run around an approval,
    // and no action may follow a pause or completion.
    const planBeforeDecision =
      calls.length === 2 &&
      calls[0].name === "update_plan" &&
      controlActions.has(calls[1].name);
    if (
      calls.length > 1 &&
      calls.some((call) => controlActions.has(call.name)) &&
      !planBeforeDecision
    ) {
      for (const call of calls)
        host.observe(
          chat,
          call,
          "Action not applied. A decision action must be alone or last after one update_plan. Do not combine it with file work or other decisions. No actions in this batch were applied.",
        );
      if (inspectCycle(calls)) return;
      continue;
    }
    for (const call of calls) {
      if (signal.aborted) throw new Error("Stopped by user");
      if (!allowed.includes(call.name)) {
        host.observe(
          chat,
          call,
          chat.project?.approved
            ? "Action rejected: this tool is not available in the current chat state."
            : "Action rejected: Choose and approve a project folder first, or use an available conversation action.",
        );
        continue;
      }
      const disposition = await host.execute(chat, call);
      if (disposition === "paused" || disposition === "finished") return;
    }
    if (inspectCycle(calls)) return;
    if (
      step + 1 >= softStepLimit &&
      (step + 1 - softStepLimit) % checkpointInterval === 0 &&
      !recentProgress.includes(true)
    ) {
      host.pause(
        host.load(),
        "Pearl made no new observed progress in the recent actions. Review the recorded work, then Continue or give a new instruction.",
        "no_progress",
      );
      return;
    }
  }
  host.pause(
    host.load(),
    "Pearl reached the safety limit for one stretch of work. The actions are saved. Continue to keep working or give a new instruction.",
    "step_budget",
  );
}
