export type PearlProviderContinuation = {
  model: string;
  reasoningContent: string;
};

export type PearlAttachment = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "docx" | "text";
  bytes: number;
  needsVision: boolean;
  pages?: number;
};

export type PearlAttachmentInput = {
  name: string;
  base64: string;
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
  /** Display provenance when an explicitly configured fallback answered. */
  fallbackModel?: string;
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  /** Original user text, without extracted document context. */
  displayText?: string;
  attachments?: PearlAttachment[];
  /** Added only for a provider request. Never persist or render this data. */
  modelImages?: string[];
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
    executionMode?: "local" | "sandbox" | "none";
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
  remoteRevision?: string;
  remoteEndpoint?: string;
  review?: { diff: string; digest: string; files: number };
  executable?: {
    path: string;
    dev: number;
    ino: number;
    mtimeMs: number;
    size: number;
  };
};

export type RemoteMcpInfo = {
  connected: boolean;
  endpoint?: string;
  revision?: string;
  tools: { name: string; description: string; inputSchema: object }[];
};

export type PearlPauseReason =
  | "repeated_action"
  | "no_progress"
  | "time_budget"
  | "step_budget"
  | "completion_missing"
  | "completion_rejected";

export type PearlTerminalState = {
  id: string;
  revision: number;
  command: string;
  args: string[];
  status: "running" | "exited" | "stopped" | "interrupted";
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  output: string;
  outputStart?: number;
  truncated: boolean;
};

export type PearlChat = {
  id: string;
  title: string;
  lifecycle?: "archived" | "trash";
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "awaiting_approval" | "paused" | "failed";
  messages: PearlMessage[];
  pendingAttachments?: PearlAttachment[];
  terminals?: PearlTerminalState[];
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
  permissions?: {
    commands: boolean;
    dependencyDownloads: boolean;
  };
  pendingTool?: PearlToolCall;
  retryHint?: "interrupted_response" | "provider_connection";
  pauseKind?: PearlPauseReason;
  streamingText?: string;
  pausedDraft?: string;
  error?: string;
  taskChanges?: import("./pearl-workspace").TaskChangeSet[];
  sandbox?: import("./pearl-sandbox").PearlSandboxState;
};

export type PearlChatSummary = Pick<
  PearlChat,
  "id" | "title" | "createdAt" | "updatedAt" | "status"
>;

export type PearlChatAPI = {
  openPearlExternalLink: (url: string) => Promise<"cancel" | "copy" | "open">;
  preparePearlAttachment: (
    id: string,
    input: PearlAttachmentInput,
  ) => Promise<PearlChat>;
  removePearlAttachment: (
    id: string,
    attachmentId: string,
  ) => Promise<PearlChat>;
  pearlSandboxConnection: () => Promise<
    import("./pearl-sandbox").PearlSandboxConnection
  >;
  configurePearlSandbox: (
    key: string,
    projectId: string,
  ) => Promise<import("./pearl-sandbox").PearlSandboxConnection>;
  pearlSandboxImages: () => Promise<
    import("./pearl-sandbox").PearlSandboxImageList
  >;
  preparePearlSandbox: (id: string, imageId: string) => Promise<PearlChat>;
  startPearlSandbox: (id: string) => Promise<PearlChat>;
  reconcilePearlSandbox: (id: string) => Promise<PearlChat>;
  forkPearlSandbox: (id: string, name: string) => Promise<PearlChat>;
  switchPearlSandboxBranch: (
    id: string,
    branchId: string,
  ) => Promise<PearlChat>;
  leavePearlSandbox: (id: string) => Promise<PearlChat>;
  reviewPearlSandboxSync: (id: string) => Promise<PearlChat>;
  approvePearlSandboxSync: (id: string, token: string) => Promise<PearlChat>;
  reviewPearlSandboxFile: (
    id: string,
    path: string,
  ) => Promise<import("./pearl-workspace").FileReview>;
  pearlSandboxSnapshot: (
    id: string,
  ) => Promise<import("./pearl-sandbox").PearlSandboxSnapshot>;
  inspectPearlSandboxFile: (
    id: string,
    path: string,
  ) => Promise<import("./pearl-workspace").FileReview>;
  remoteMcpInfo?: () => Promise<RemoteMcpInfo>;
  connectRemoteMcp?: (
    endpoint: string,
    bearerToken: string,
  ) => Promise<RemoteMcpInfo>;
  disconnectRemoteMcp?: () => Promise<RemoteMcpInfo>;
  listPearlModels?: () => Promise<import("./runs").ModelOption[]>;
  selectPearlModels?: (
    value: import("./runs").SessionModelSelection,
  ) => Promise<import("./runs").SessionInfo>;
  webSearchInfo: () => Promise<{ configured: boolean }>;
  configureWebSearch: (key: string) => Promise<{ configured: boolean }>;
  disconnectWebSearch: () => Promise<{ configured: boolean }>;
  listPearlChats: (
    scope?: "active" | "archived",
  ) => Promise<PearlChatSummary[]>;
  createPearlChat: () => Promise<PearlChat>;
  getPearlChat: (id: string) => Promise<PearlChat>;
  archivePearlChat: (id: string) => Promise<PearlChat>;
  restorePearlChat: (id: string) => Promise<PearlChat>;
  deletePearlChatPermanently: (id: string) => Promise<void>;
  sendPearlMessage: (id: string, text: string) => Promise<PearlChat>;
  choosePearlProject: (id?: string) => Promise<PearlChat | null>;
  approvePearlProject: (id: string, approved: boolean) => Promise<PearlChat>;
  updatePearlPermission: (
    id: string,
    permission: "commands" | "dependencyDownloads",
    enabled: boolean,
  ) => Promise<PearlChat>;
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
  sendPearlTerminalInput: (
    id: string,
    terminalId: string,
    value: string,
  ) => Promise<void>;
  resizePearlTerminal: (
    id: string,
    terminalId: string,
    cols: number,
    rows: number,
  ) => Promise<void>;
  stopPearlTerminal: (id: string, terminalId: string) => Promise<PearlChat>;
  renamePearlChat: (id: string, title: string) => Promise<PearlChat>;
  listPearlProjectFiles: (
    id: string,
    directory?: string,
    offset?: number,
  ) => Promise<import("./pearl-workspace").WorkspaceEntry[]>;
  readPearlProjectFile: (id: string, path: string) => Promise<string>;
  pearlGitView: (id: string) => Promise<import("./pearl-workspace").GitView>;
  pearlGitDiff: (id: string, path: string, commit?: string) => Promise<string>;
  pearlGitCommitFiles: (
    id: string,
    commit: string,
  ) => Promise<{ status: string; path: string }[]>;
  reviewPearlTaskFile: (
    id: string,
    turnId: string,
    path: string,
  ) => Promise<import("./pearl-workspace").FileReview>;
  undoPearlTask: (id: string, turnId: string) => Promise<PearlChat>;
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
  executionMode: "local" | "sandbox" | "none";
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
      ![
        "create_file",
        "write_file",
        "replace_in_file",
        "apply_patch",
        "edit_files",
      ].includes(message.toolName || "") &&
      message.toolName !== "run_command" &&
      message.toolName !== "sandbox_run_check" &&
      message.toolName !== "browser_check" &&
      message.toolName !== "preview_app"
    )
      continue;
    if (["run_command", "sandbox_run_check"].includes(message.toolName || ""))
      latestSuccessfulCommand = -1;
    if (["browser_check", "preview_app"].includes(message.toolName || ""))
      latestSuccessfulBrowser = -1;
    try {
      const result = JSON.parse(message.text) as Record<string, unknown>;
      if (
        ["run_command", "sandbox_run_check"].includes(message.toolName || "")
      ) {
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
      } else if (
        result.written === true &&
        (typeof result.path === "string" || Array.isArray(result.files))
      ) {
        const paths =
          typeof result.path === "string"
            ? [result.path]
            : (result.files as unknown[]).filter(
                (item): item is string => typeof item === "string",
              );
        filesWritten += paths.length;
        latestWrite = index;
        uiFilesWritten += paths.filter((path) =>
          /\.(?:html|css|jsx|tsx|vue|svelte)$/iu.test(path),
        ).length;
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
    executionMode:
      filesWritten > 0 || commandsCompleted > 0 || browserChecks > 0
        ? chat.sandbox?.active
          ? "sandbox"
          : "local"
        : "none",
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
      [
        "create_file",
        "write_file",
        "replace_in_file",
        "apply_patch",
        "edit_files",
      ].includes(message.toolName || "")
    ) {
      try {
        if (JSON.parse(message.text).written === true) latestWrite = index;
      } catch {
        /* Rejected and invalid actions are not completed writes. */
      }
    }
    if (!["run_command", "sandbox_run_check"].includes(message.toolName || ""))
      continue;
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
