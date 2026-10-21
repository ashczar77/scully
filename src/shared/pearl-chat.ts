export type PearlProviderContinuation = {
  model: string;
  reasoningContent: string;
};

export type PearlWorkState = {
  revision: number;
  sourceUserMessageId: string;
  objective: string;
  approach: string;
  requirements: { quote: string; sourceUserMessageId: string }[];
  steps: { text: string; status: "pending" | "in_progress" | "completed" }[];
};

export type PearlMessage = {
  /** Backend-only provider protocol state; never render or use as authority. */
  providerContinuation?: PearlProviderContinuation;
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: string;
  toolCalls?: PearlToolCall[];
  questionId?: string;
  evidence?: {
    projectApproved?: boolean;
    filesWritten: number;
    uiFilesWritten?: number;
    commandsCompleted: number;
    browserChecks?: number;
    successfulCommandAfterLatestWrite?: boolean;
    successfulBrowserAfterLatestUiWrite?: boolean;
  };
  completion?: {
    status: "done" | "partial" | "blocked" | "unverified";
    remaining?: string;
  };
};

export type PearlQuestion = {
  id: string;
  topic: string;
  text: string;
  options: string[];
  recommendation?: string;
  askedAt: string;
  askedByToolCallId?: string;
  status: "pending" | "answered" | "superseded" | "withdrawn";
  answer?: string;
  answeredByMessageId?: string;
  reopenedFrom?: string;
  reopenReason?: string;
};

export type PearlToolCall = {
  id: string;
  name: string;
  arguments: string;
  executable?: {
    path: string;
    dev: number;
    ino: number;
    mtimeMs: number;
    size: number;
  };
};

export type PearlPauseReason =
  | "repeated_action"
  | "no_progress"
  | "time_budget"
  | "step_budget"
  | "completion_missing";

export type PearlChat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "awaiting_approval" | "paused" | "failed";
  messages: PearlMessage[];
  activeUserMessageId?: string;
  questions: PearlQuestion[];
  readRevisions?: Record<string, string>;
  work?: PearlWorkState;
  project?: {
    path: string;
    dev: number;
    ino: number;
    approved: boolean;
  };
  pendingTool?: PearlToolCall;
  retryHint?: "interrupted_response";
  pauseKind?: PearlPauseReason;
  streamingText?: string;
  error?: string;
};

export type PearlChatSummary = Pick<
  PearlChat,
  "id" | "title" | "createdAt" | "updatedAt" | "status"
>;

export type PearlChatAPI = {
  listPearlChats: () => Promise<PearlChatSummary[]>;
  createPearlChat: () => Promise<PearlChat>;
  getPearlChat: (id: string) => Promise<PearlChat>;
  sendPearlMessage: (id: string, text: string) => Promise<PearlChat>;
  choosePearlProject: (id: string) => Promise<PearlChat | null>;
  approvePearlProject: (id: string, approved: boolean) => Promise<PearlChat>;
  decidePearlTool: (
    id: string,
    toolCallId: string,
    approved: boolean,
  ) => Promise<PearlChat>;
  answerPearlQuestion: (
    id: string,
    questionId: string,
    answer: string,
  ) => Promise<PearlChat>;
  retryPearlChat: (id: string) => Promise<PearlChat>;
  stopPearlChat: (id: string) => Promise<PearlChat>;
  onPearlChatUpdate: (listener: (chat: PearlChat) => void) => () => void;
};

export function currentTurnEvidence(chat: PearlChat): {
  projectApproved: boolean;
  filesWritten: number;
  uiFilesWritten: number;
  commandsCompleted: number;
  browserChecks: number;
  successfulCommandAfterLatestWrite: boolean;
  successfulBrowserAfterLatestUiWrite: boolean;
} {
  const start = chat.messages.findIndex(
    (message) => message.id === chat.activeUserMessageId,
  );
  const messages = start < 0 ? [] : chat.messages.slice(start + 1);
  let filesWritten = 0;
  let uiFilesWritten = 0;
  let commandsCompleted = 0;
  let browserChecks = 0;
  let latestWrite = -1;
  let latestSuccessfulCommand = -1;
  let latestSuccessfulBrowser = -1;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "tool") continue;
    if (
      !["create_file", "write_file", "replace_in_file", "apply_patch"].includes(
        message.toolName || "",
      ) &&
      message.toolName !== "run_command" &&
      message.toolName !== "browser_check" &&
      message.toolName !== "preview_app"
    )
      continue;
    if (message.toolName === "run_command") latestSuccessfulCommand = -1;
    if (["browser_check", "preview_app"].includes(message.toolName || ""))
      latestSuccessfulBrowser = -1;
    try {
      const result = JSON.parse(message.text) as Record<string, unknown>;
      if (message.toolName === "run_command") {
        if (typeof result.exitCode === "number") {
          commandsCompleted++;
          latestSuccessfulCommand = result.exitCode === 0 ? index : -1;
        }
      } else if (
        ["browser_check", "preview_app"].includes(message.toolName || "")
      ) {
        if (
          typeof result.visibleText === "string" &&
          Array.isArray(result.errors) &&
          Array.isArray(result.hiddenViolations) &&
          typeof result.blockedExternalRequests === "number"
        ) {
          browserChecks++;
          latestSuccessfulBrowser = -1;
          if (
            result.visibleText.trim() &&
            result.errors.length === 0 &&
            result.hiddenViolations.length === 0 &&
            result.blockedExternalRequests === 0
          )
            latestSuccessfulBrowser = index;
        }
      } else if (result.written === true && typeof result.path === "string") {
        filesWritten++;
        latestWrite = index;
        if (/\.(?:html|css|jsx|tsx|vue|svelte)$/iu.test(result.path)) {
          uiFilesWritten++;
        }
      }
    } catch {
      /* Invalid or denied action is not evidence of a completed operation. */
    }
  }
  return {
    projectApproved: Boolean(chat.project?.approved),
    filesWritten,
    uiFilesWritten,
    commandsCompleted,
    browserChecks,
    successfulCommandAfterLatestWrite:
      latestSuccessfulCommand >= 0 && latestSuccessfulCommand > latestWrite,
    successfulBrowserAfterLatestUiWrite:
      latestSuccessfulBrowser >= 0 && latestSuccessfulBrowser > latestWrite,
  };
}

export function needsPostEditBrowserCheck(chat: PearlChat): boolean {
  const evidence = currentTurnEvidence(chat);
  return (
    (evidence.uiFilesWritten > 0 || evidence.browserChecks > 0) &&
    !evidence.successfulBrowserAfterLatestUiWrite
  );
}

export function needsPostEditCheck(chat: PearlChat): boolean {
  const start = chat.messages.findIndex(
    (message) => message.id === chat.activeUserMessageId,
  );
  if (start < 0) return false;
  let latestWrite = -1;
  let latestSuccessfulCommand = -1;
  let latestDenial = -1;
  for (let index = start + 1; index < chat.messages.length; index++) {
    const message = chat.messages[index];
    if (message.role !== "tool") continue;
    if (
      ["create_file", "write_file", "replace_in_file", "apply_patch"].includes(
        message.toolName || "",
      )
    ) {
      try {
        if (JSON.parse(message.text).written === true) latestWrite = index;
      } catch {
        /* Rejected and invalid actions are not completed writes. */
      }
    }
    if (message.toolName !== "run_command") continue;
    if (message.text.startsWith("User denied this command.")) {
      latestDenial = index;
      continue;
    }
    try {
      latestSuccessfulCommand =
        JSON.parse(message.text).exitCode === 0 ? index : -1;
    } catch {
      /* An unavailable command is not a successful check. */
    }
  }
  return (
    latestWrite >= 0 &&
    latestSuccessfulCommand < latestWrite &&
    latestDenial < latestWrite
  );
}
