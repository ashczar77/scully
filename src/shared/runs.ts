import type { CommandProposal, CommandSpec, RecheckLineage } from "./commands";
import type { ExecutionReview, ExecutionResult } from "./execution";
import type { ApplyReview, ApplyResult, RecoveryInspection } from "./apply";
import type { ArtifactInventory } from "./artifacts";
import type {
  AuditKind,
  SpecialistAudit,
  FindingDecision,
  FindingDecisionInput,
} from "./audits";
import type { Coordination, CoordinationSettings } from "./coordination";
import type {
  CloudConfig,
  CloudSession,
  CloudReview,
  CloudExecution,
  CloudImageCatalog,
  CloudExecutableResolution,
  CloudReviewOptions,
} from "./cloud";
export type SourceFile = { path: string; content: string };
export type SourceSelection = {
  id: string;
  name: string;
  files: SourceFile[];
  excluded: number;
};
export type DraftFile = SourceFile & { before: string | null };
export type RunStatus =
  | "prepared"
  | "planning"
  | "planned"
  | "building"
  | "auditing"
  | "complete"
  | "failed"
  | "stopped"
  | "interrupted"
  | "conflicted";
export type RunEvent = {
  actor: "system" | "maya" | "ellis" | "jun";
  text: string;
  at: string;
};
export type InFlightRequest = {
  id: string;
  actor: "maya" | "ellis" | "jun";
  name:
    | "propose_plan"
    | "propose_files"
    | "audit_chunk"
    | "audit_files"
    | "specialist_audit"
    | "respond_to_audit";
  startedAt: string;
};
export type Finding = {
  path: string;
  severity: "info" | "warning" | "error";
  detail: string;
};
export type Run = {
  suggestions?: import("./suggestions").DeferredSuggestion[];
  reviewedSuggestionIds?: string[];
  replies?: import("./messages").TeamReply[];
  messages?: import("./messages").TeamMessage[];
  redirection?: {
    parentId: string;
    instructions: string[];
    previousPlan: string;
    previousDrafts: DraftFile[];
  };
  redirectedTo?: string;
  correction?: {
    parentId: string;
    parentRevision: string;
    auditIndex: number;
    findingIndex: number;
    finding: Finding;
    parentDrafts: DraftFile[];
    recheck?: RecheckLineage & { command: CommandSpec };
  };
  findingDecisions?: FindingDecision[];
  specialistAudits?: SpecialistAudit[];
  id: string;
  taskId: string;
  sourceName: string;
  files: SourceFile[];
  status: RunStatus;
  events: RunEvent[];
  inFlightRequests?: InFlightRequest[];
  plan: string;
  drafts: DraftFile[];
  findings: Finding[];
  checks: string[];
  error: string;
  calls: number;
  model: string;
  outputTokens: number;
  commands?: CommandProposal[];
  executions?: ExecutionResult[];
  cloudExecutions?: CloudExecution[];
  applications?: ApplyResult[];
  coordination?: Coordination;
};
export type SessionConfig = {
  key: string;
  model: string;
  outputTokens: number;
};
export type SessionInfo = {
  configured: boolean;
  model: string;
  outputTokens: number;
};
export type RunAPI = {
  inspectLocalArtifacts: () => Promise<ArtifactInventory>;
  resolveCloudExecutable: (
    id: string,
    commandId: string,
    image: string,
    parentExecutionId?: string,
  ) => Promise<CloudExecutableResolution>;
  cloudImages: (tagPrefix: string) => Promise<CloudImageCatalog>;
  cloudSession: () => Promise<CloudSession>;
  configureCloud: (config: CloudConfig) => Promise<CloudSession>;
  reviewCloud: (
    id: string,
    commandId: string,
    image: string,
    executable: string,
    options?: CloudReviewOptions,
  ) => Promise<CloudReview>;
  submitCloud: (token: string, approved: boolean) => Promise<Run>;
  refreshCloud: (runId: string, executionId: string) => Promise<Run>;
  stopReply: (id: string) => Promise<Run>;
  reviewSuggestion: (id: string, suggestionId: string) => Promise<Run>;
  reviewReply: (
    id: string,
    messageId: string,
    recipientId?: string,
  ) => Promise<import("./messages").ReplyReview>;
  answerMessage: (token: string, approved: boolean) => Promise<Run>;
  sendTeamMessage: (
    id: string,
    message: import("./messages").TeamMessageInput,
  ) => Promise<Run>;
  metrics: () => Promise<import("./telemetry").MetricSnapshot>;
  prepareCorrection: (
    id: string,
    auditIndex: number,
    findingIndex: number,
    revision: string,
    findingKey: string,
  ) => Promise<Run>;
  decideFinding: (id: string, decision: FindingDecisionInput) => Promise<Run>;
  startAudit: (
    id: string,
    kind: AuditKind,
    revision: string,
    approved: boolean,
  ) => Promise<Run>;
  selectSource: () => Promise<SourceSelection | null>;
  prepareRun: (
    taskId: string,
    sourceId: string | null,
    paths: string[],
  ) => Promise<Run>;
  runs: (taskId: string) => Promise<Run[]>;
  session: () => Promise<SessionInfo>;
  configureSession: (config: SessionConfig) => Promise<SessionInfo>;
  startRun: (id: string, approved: boolean) => Promise<Run>;
  stopRun: (id: string) => Promise<Run>;
  decideCommand: (
    id: string,
    commandId: string,
    revision: string,
    decision: "approved" | "denied",
  ) => Promise<Run>;
  onRun: (callback: (run: Run) => void) => () => void;
  reviewExecution: (id: string, commandId: string) => Promise<ExecutionReview>;
  executeCommand: (token: string, approved: boolean) => Promise<Run>;
  stopExecution: (id: string) => Promise<Run>;
  reviewApply: (id: string) => Promise<ApplyReview | null>;
  applyDraft: (token: string, approved: boolean) => Promise<Run>;
  inspectApplyRecovery: (
    runId: string,
    applicationId: string,
  ) => Promise<RecoveryInspection>;
  configureCoordination: (
    id: string,
    settings: CoordinationSettings,
  ) => Promise<Run>;
};
export function validateSession(value: unknown): SessionConfig {
  const v = value as SessionConfig;
  if (
    !v ||
    typeof v.key !== "string" ||
    v.key.trim().length < 8 ||
    v.key.length > 4096 ||
    /\s/.test(v.key.trim()) ||
    typeof v.model !== "string" ||
    !/^[\w./:-]{1,160}$/.test(v.model) ||
    !Number.isInteger(v.outputTokens) ||
    v.outputTokens < 512 ||
    v.outputTokens > 4096
  )
    throw new Error("Enter a valid key, model ID and output limit (512-4096).");
  return { key: v.key.trim(), model: v.model, outputTokens: v.outputTokens };
}
export function safePath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length > 240 ||
    !path ||
    path.includes("\\") ||
    path.includes(":") ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path
      .split("/")
      .some((s) => !s || s === ".." || s === "." || s.startsWith(".")) ||
    /(^|\/)(node_modules|vendor|dist|build|out|coverage)(\/|$)/i.test(path) ||
    /(^|\/)(credentials|secrets?)([./]|$)/i.test(path) ||
    /\.(pem|key|p12|pfx|sqlite|db)$/i.test(path)
  )
    throw new Error("Unsafe or private file path");
  if (
    path
      .split("/")
      .some(
        (s) =>
          /[. ]$/.test(s) ||
          /[<>"|?*]/.test(s) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s),
      )
  )
    throw new Error("Unsupported cross-platform file path");
}
export function containsSecret(content: string) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-|tvly-|ghp_)[A-Za-z0-9_-]{16,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{16,}["']/i.test(
    content,
  );
}
export function parseDraft(value: unknown): {
  summary: string;
  files: SourceFile[];
} {
  const v = value as { summary: string; files: SourceFile[] };
  if (
    !v ||
    typeof v.summary !== "string" ||
    v.summary.length > 4000 ||
    !Array.isArray(v.files) ||
    !v.files.length ||
    v.files.length > 12
  )
    throw new Error("Invalid builder response");
  const names = new Set<string>();
  let size = 0;
  for (const f of v.files) {
    if (!f) throw new Error("Invalid file");
    safePath(f.path);
    const name = f.path.toLowerCase();
    if (
      names.has(name) ||
      [...names].some(
        (n) => n.startsWith(name + "/") || name.startsWith(n + "/"),
      )
    )
      throw new Error("Conflicting output paths");
    names.add(name);
    if (typeof f.content !== "string" || containsSecret(f.content))
      throw new Error("Unsafe file content");
    size += new TextEncoder().encode(f.content).length;
  }
  if (size > 48_000) throw new Error("Draft exceeds the 48 KB output limit");
  return {
    summary: v.summary,
    files: v.files.map((f) => ({ path: f.path, content: f.content })),
  };
}
export function parseAudit(
  value: unknown,
  paths: string[],
): { summary: string; findings: Finding[] } {
  const v = value as { summary: string; findings: Finding[] };
  if (
    !v ||
    typeof v.summary !== "string" ||
    v.summary.length > 4000 ||
    !Array.isArray(v.findings) ||
    v.findings.length > 30
  )
    throw new Error("Invalid auditor response");
  for (const f of v.findings)
    if (
      !f ||
      !paths.includes(f.path) ||
      !["info", "warning", "error"].includes(f.severity) ||
      typeof f.detail !== "string" ||
      !f.detail.trim() ||
      f.detail.length > 2000
    )
      throw new Error("Invalid audit finding");
  return {
    summary: v.summary,
    findings: v.findings.map((f) => ({
      path: f.path,
      severity: f.severity,
      detail: f.detail,
    })),
  };
}
