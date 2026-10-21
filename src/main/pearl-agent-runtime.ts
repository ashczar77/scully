import { createHash } from "node:crypto";
import type { PearlModelResult } from "../engine/pearl-model";
import type {
  PearlChat,
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
  ) => void;
  observe: (chat: PearlChat, call: PearlToolCall, observation: string) => void;
  execute: (chat: PearlChat, call: PearlToolCall) => Promise<ActionDisposition>;
  finish: (chat: PearlChat, text: string) => void;
  pause: (chat: PearlChat, reason: string, kind: PearlPauseReason) => void;
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
  return (
    !value ||
    /^(Action (failed|rejected|not applied)|Question rejected|Withdrawal rejected|Answer link rejected|Completion rejected|Invalid )/u.test(
      value,
    )
  );
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
          call.arguments,
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
    !["create_file", "write_file", "replace_in_file", "apply_patch"].includes(
      call.name,
    )
  )
    return false;
  try {
    return JSON.parse(observation).written === true;
  } catch {
    return false;
  }
}

const controlActions = new Set([
  "run_command",
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
    const fingerprint = cycleFingerprint(calls, observations);
    const count = (seenCycles.get(fingerprint) || 0) + 1;
    seenCycles.set(fingerprint, count);
    const progressed =
      count === 1 && observations.some((value) => !failedObservation(value));
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
        ? "\nA web UI file changed after the latest clean browser observation. Use browser_check on the static HTML entry and inspect rendered behavior, errors, and hidden-state violations before concluding. If the browser check is unavailable or fails, report the UI as unverified."
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
          "Pearl changed project files but did not provide an evidence-backed completion. The actions are saved. Continue to finish or give a new instruction.",
          "completion_missing",
        );
        return;
      }
      host.finish(chat, result.text);
      return;
    }
    const calls = result.kind === "tool" ? [result.call] : result.calls;
    validateBatch(calls);
    host.recordActions(chat, calls, result.text);

    // A user decision or command approval pauses the turn. Request those
    // actions alone so no other action can be lost or run around the pause.
    if (
      calls.length > 1 &&
      calls.some((call) => controlActions.has(call.name))
    ) {
      for (const call of calls)
        host.observe(
          chat,
          call,
          "Action not applied. Request approval and question actions individually; then continue with other actions.",
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
