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
  root?: string;
  files: SourceFile[];
  excluded: number;
};
export type ProjectWorkspace = {
  path: string;
  kind: "new" | "existing";
  dev: number;
  ino: number;
  writtenFiles?: string[];
};
export type DraftFile = SourceFile & { before: string | null };
export type RunStatus =
  | "prepared"
  | "planning"
  | "planned"
  | "awaiting_input"
  | "building"
  | "auditing"
  | "complete"
  | "failed"
  | "stopped"
  | "interrupted"
  | "conflicted";
export type RunEvent = {
  actor: string;
  actorName?: string;
  actorRole?: string;
  actorPortraitId?: import("./contracts").Teammate["portraitId"];
  text: string;
  at: string;
  questionId?: string;
};
export type BuildQuestion = {
  id: string;
  actor: string;
  text: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
};
export type InFlightRequest = {
  id: string;
  actor: string;
  name:
    | "propose_plan"
    | "propose_files"
    | "audit_chunk"
    | "audit_files"
    | "specialist_audit"
    | "respond_to_audit"
    | "consult_specialist";
  startedAt: string;
};
export type Finding = {
  path: string;
  severity: "info" | "warning" | "error";
  detail: string;
};
export type Run = {
  planningConsultationPolicy?: "automatic" | "ask";
  diagnostics?: import("./request-diagnostics").RequestDiagnostic[];
  requestPause?: {
    id: string;
    status:
      | "requested"
      | "paused"
      | "resuming"
      | "resumed"
      | "not_reached"
      | "stopped"
      | "interrupted";
    attempts: number;
    requestedAt: string;
    reachedAt?: string;
    resolvedAt?: string;
  };
  consultations?: import("./consultation").SpecialistConsultation[];
  approvedAdvice?: import("../engine/advice-handoff").AdviceApproval[];
  lineupProposal?: import("./lineup-proposal").LineupProposal;
  approvedLineup?: import("./lineup-proposal").ApprovedSpecialistLineup;
  suggestions?: import("./suggestions").DeferredSuggestion[];
  reviewedSuggestionIds?: string[];
  replies?: import("./messages").TeamReply[];
  messages?: import("./messages").TeamMessage[];
  pendingQuestions?: BuildQuestion[];
  redirection?: {
    parentId: string;
    instructions: string[];
    previousPlan: string;
    previousDrafts: DraftFile[];
    conversation?: { from: string; text: string }[];
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
  taskSnapshot?: import("./contracts").TaskInput;
  teamSnapshot?: import("./teams").SavedTeam;
  sourceName: string;
  workspaceMode?: "direct";
  projectWorkspace?: ProjectWorkspace;
  files: SourceFile[];
  status: RunStatus;
  events: RunEvent[];
  inFlightRequests?: InFlightRequest[];
  plan: string;
  planReply?: string;
  planningRetries?: number;
  drafts: DraftFile[];
  findings: Finding[];
  checks: string[];
  error: string;
  calls: number;
  model: string;
  roleModels?: import("./role-models").RoleModelSettings;
  outputTokens: number;
  usagePolicy?: import("./usage-policy").UsagePolicy;
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
export type ModelOption = { id: string; name: string };
export type RunAPI = {
  roleModelSettings: () => Promise<import("./role-models").RoleModelSettings>;
  setRoleModelSettings: (
    value: import("./role-models").RoleModelSettings,
  ) => Promise<import("./role-models").RoleModelSettings>;
  planningSettings: () => Promise<
    import("./planning-settings").PlanningSettings
  >;
  setPlanningSettings: (
    value: import("./planning-settings").PlanningSettings,
  ) => Promise<import("./planning-settings").PlanningSettings>;
  rawCaptureStatus: () => Promise<{ armed: boolean; saved: boolean }>;
  armRawCapture: () => Promise<{ armed: boolean; saved: boolean }>;
  readRawCapture: () => Promise<{
    request: string;
    response: string | null;
    httpStatus: number | null;
  } | null>;
  clearRawCapture: () => Promise<{ armed: boolean; saved: boolean }>;
  conversationAllowance: (id: string) => Promise<{
    remaining: number;
    model: string;
    outputTokens: number;
    valid: boolean;
  }>;
  reviewConversation: (id: string) => Promise<{
    token: string;
    expiresAt: number;
    remaining: number;
    model: string;
    outputTokens: number;
  }>;
  approveConversation: (
    id: string,
    token: string,
    approved: boolean,
  ) => Promise<{
    remaining: number;
    model: string;
    outputTokens: number;
    valid: boolean;
  }>;
  autoAnswerMessage: (
    id: string,
    messageId: string,
    recipientId?: string,
  ) => Promise<Run>;
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
  reviewRoutedReply: (
    id: string,
    messageId: string,
  ) => Promise<{
    routing: ReturnType<typeof import("./message-routing").routeTeamMessage>;
    needsConnection: boolean;
    review: import("./messages").ReplyReview | null;
  }>;
  messageRoutingSettings: () => Promise<
    import("./message-routing").MessageRoutingSettings
  >;
  setMessageRoutingSettings: (
    value: import("./message-routing").MessageRoutingSettings,
  ) => Promise<import("./message-routing").MessageRoutingSettings>;
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
    workspaceMode?: "direct",
  ) => Promise<Run>;
  chooseProjectWorkspace: (id: string) => Promise<Run | null>;
  openProjectWorkspace: (id: string) => Promise<void>;
  gitHistory: (id: string) => Promise<import("./git-history").GitHistory>;
  initializeGit: (id: string) => Promise<import("./git-history").GitHistory>;
  runs: (taskId: string) => Promise<Run[]>;
  usageForRun: (id: string) => Promise<import("./usage").UsageSnapshot>;
  usageAlertsForRun: (
    id: string,
  ) => Promise<import("./usage-alerts").UsageAlertSnapshot>;
  costForRun: (id: string) => Promise<import("./model-cost").CostSnapshot>;
  configureCost: (
    id: string,
    value: import("./model-cost").CostSettings,
  ) => Promise<import("./model-cost").CostSnapshot>;
  configureUsageAlerts: (
    id: string,
    value: import("./usage-alerts").UsageAlertPolicy,
  ) => Promise<import("./usage-alerts").UsageAlertSnapshot>;
  continueUsage: (
    id: string,
    pauseId: string,
  ) => Promise<import("./usage-alerts").UsageAlertSnapshot>;
  saveTokensForRemaining: (id: string) => Promise<Run>;
  session: () => Promise<SessionInfo>;
  configureSession: (config: SessionConfig) => Promise<SessionInfo>;
  listModels: () => Promise<ModelOption[]>;
  selectRunModel: (id: string, model: string) => Promise<Run>;
  selectDefaultModel: (model: string) => Promise<SessionInfo>;
  sendPlanningMessage: (id: string, text: string) => Promise<Run>;
  retryPlanning: (id: string) => Promise<Run>;
  sendConversationMessage: (
    id: string,
    text: string,
    recipientId?: string,
  ) => Promise<{ run: Run; needsChoice: boolean }>;
  answerConversationMessage: (
    id: string,
    messageId: string,
    recipientId: string,
  ) => Promise<Run>;
  answerBuildQuestion: (
    id: string,
    questionId: string,
    answer: string,
  ) => Promise<Run>;
  configureUsagePolicy: (
    id: string,
    choice: import("./usage-policy").UsagePolicyChoice,
    reviewToken: string | null,
  ) => Promise<Run>;
  reviewUsagePolicy: (
    id: string,
    choice: import("./usage-policy").UsagePolicyChoice,
  ) => Promise<{ token: string; policy: import("./usage-policy").UsagePolicy }>;
  startRun: (id: string, approved: boolean) => Promise<Run>;
  approveLineup: (
    id: string,
    planRevision: string,
    entries: import("./lineup-proposal").SpecialistLineupEntry[],
    approved: boolean,
    core?: import("./core-lineup").CoreLineup,
  ) => Promise<Run>;
  reviewConsultation: (
    id: string,
    specialistId: string,
  ) => Promise<import("./consultation").ConsultationReview>;
  startConsultation: (token: string, approved: boolean) => Promise<Run>;
  stopConsultation: (id: string) => Promise<Run>;
  reviewAdvice: (
    id: string,
    consultationId: string,
    answers?: string[],
  ) => Promise<import("../engine/advice-handoff").AdviceReview>;
  approveAdvice: (token: string, approved: boolean) => Promise<Run>;
  removeAdvice: (id: string, consultationId: string) => Promise<Run>;
  stopRun: (id: string) => Promise<Run>;
  requestRunPause: (id: string) => Promise<Run>;
  resumeRunPause: (id: string, pauseId: string) => Promise<Run>;
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
export function normalizeDraftPath(path: unknown): string {
  if (typeof path !== "string")
    throw new Error("Writer proposed an invalid file path");
  const normalized = path.startsWith("./") ? path.slice(2) : path;
  if (normalized.startsWith("/"))
    throw new Error("Writer proposed an absolute file path");
  if (normalized.split("/").includes(".."))
    throw new Error("Writer proposed a parent directory file path");
  if (normalized.split("/").some((part) => part.startsWith(".")))
    throw new Error("Writer proposed a hidden or private file path");
  try {
    safePath(normalized);
  } catch {
    throw new Error("Writer proposed an unsafe or unsupported file path");
  }
  return normalized;
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
  const files: SourceFile[] = [];
  for (const f of v.files) {
    if (!f) throw new Error("Invalid file");
    const path = normalizeDraftPath(f.path);
    const name = path.toLowerCase();
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
    files.push({ path, content: f.content });
  }
  if (size > 48_000) throw new Error("Draft exceeds the 48 KB output limit");
  return {
    summary: v.summary,
    files,
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
