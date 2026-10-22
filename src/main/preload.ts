import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../shared/contracts";
const api: DesktopAPI = {
  webSearchInfo: () => ipcRenderer.invoke("pearl:web:info"),
  configureWebSearch: (key) => ipcRenderer.invoke("pearl:web:configure", key),
  disconnectWebSearch: () => ipcRenderer.invoke("pearl:web:disconnect"),
  listPearlChats: (scope) => ipcRenderer.invoke("pearl:list", scope),
  createPearlChat: () => ipcRenderer.invoke("pearl:create"),
  getPearlChat: (id) => ipcRenderer.invoke("pearl:get", id),
  archivePearlChat: (id) => ipcRenderer.invoke("pearl:archive", id),
  trashPearlChat: (id) => ipcRenderer.invoke("pearl:trash", id),
  restorePearlChat: (id) => ipcRenderer.invoke("pearl:restore", id),
  deletePearlChatPermanently: (id) =>
    ipcRenderer.invoke("pearl:permanent-delete", id),
  sendPearlMessage: (id, text) => ipcRenderer.invoke("pearl:send", id, text),
  choosePearlProject: (id) => ipcRenderer.invoke("pearl:project:choose", id),
  approvePearlProject: (id, approved) =>
    ipcRenderer.invoke("pearl:project:approve", id, approved),
  decidePearlTool: (id, toolCallId, approved) =>
    ipcRenderer.invoke("pearl:tool:decide", id, toolCallId, approved),
  answerPearlQuestion: (id, questionId, answer) =>
    ipcRenderer.invoke("pearl:question:answer", id, questionId, answer),
  retryPearlChat: (id) => ipcRenderer.invoke("pearl:retry", id),
  stopPearlChat: (id) => ipcRenderer.invoke("pearl:stop", id),
  onPearlChatUpdate: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      chat: import("../shared/pearl-chat").PearlChat,
    ) => listener(chat);
    ipcRenderer.on("pearl:update", handler);
    return () => ipcRenderer.removeListener("pearl:update", handler);
  },
  reviewCollaboration: (id, options) =>
    ipcRenderer.invoke("collaboration:review", id, options),
  recommendEnvironments: (id) =>
    ipcRenderer.invoke("collaboration:environments", id),
  reviewLocalFallback: (id, actor) =>
    ipcRenderer.invoke("collaboration:local-review", id, actor),
  approveLocalFallback: (token, approved) =>
    ipcRenderer.invoke("collaboration:local-approve", token, approved),
  reviewDispatchProposal: (id, proposalId) =>
    ipcRenderer.invoke("collaboration:proposal-review", id, proposalId),
  approveCollaboration: (token, approved) =>
    ipcRenderer.invoke("collaboration:approve", token, approved),
  sendCollaborationMessage: (id, text, recipient, questionId) =>
    ipcRenderer.invoke(
      "collaboration:message",
      id,
      text,
      recipient,
      questionId,
    ),
  continueTeammate: (id, actor, guidance) =>
    ipcRenderer.invoke("collaboration:continue", id, actor, guidance),
  reconcileCollaboration: (id, operationId) =>
    ipcRenderer.invoke("collaboration:reconcile", id, operationId),
  reviewSpecialistDispatch: (id, memberId, permissions, headId) =>
    ipcRenderer.invoke(
      "collaboration:dispatch-review",
      id,
      memberId,
      permissions,
      headId,
    ),
  approveSpecialistDispatch: (token, approved) =>
    ipcRenderer.invoke("collaboration:dispatch-approve", token, approved),
  reviewCollaborationSync: (id) =>
    ipcRenderer.invoke("collaboration:sync-review", id),
  approveCollaborationSync: (token, approved) =>
    ipcRenderer.invoke("collaboration:sync-approve", token, approved),
  roleModelSettings: () => ipcRenderer.invoke("models:roles"),
  setRoleModelSettings: (value) =>
    ipcRenderer.invoke("models:roles:set", value),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  rawCaptureStatus: () => ipcRenderer.invoke("capture:status"),
  armRawCapture: () => ipcRenderer.invoke("capture:arm"),
  readRawCapture: () => ipcRenderer.invoke("capture:read"),
  clearRawCapture: () => ipcRenderer.invoke("capture:clear"),
  conversationAllowance: (id) =>
    ipcRenderer.invoke("conversation:allowance", id),
  reviewConversation: (id) => ipcRenderer.invoke("conversation:review", id),
  approveConversation: (id, token, approved) =>
    ipcRenderer.invoke("conversation:approve", id, token, approved),
  autoAnswerMessage: (id, messageId, recipientId) =>
    ipcRenderer.invoke("conversation:auto-answer", id, messageId, recipientId),
  inspectLocalArtifacts: () => ipcRenderer.invoke("storage:inspect"),
  cloudImages: (tagPrefix) => ipcRenderer.invoke("cloud:images", tagPrefix),
  resolveCloudExecutable: (id, commandId, image, parentExecutionId) =>
    ipcRenderer.invoke(
      "cloud:resolve",
      id,
      commandId,
      image,
      parentExecutionId,
    ),
  cloudSession: () => ipcRenderer.invoke("cloud:session"),
  configureCloud: (value) => ipcRenderer.invoke("cloud:configure", value),
  reviewCloud: (id, commandId, image, executable, options) =>
    ipcRenderer.invoke(
      "cloud:review",
      id,
      commandId,
      image,
      executable,
      options,
    ),
  submitCloud: (token, approved) =>
    ipcRenderer.invoke("cloud:submit", token, approved),
  refreshCloud: (runId, executionId) =>
    ipcRenderer.invoke("cloud:refresh", runId, executionId),
  sendTeamMessage: (id, value) => ipcRenderer.invoke("message:send", id, value),
  stopReply: (id) => ipcRenderer.invoke("reply:stop", id),
  reviewSuggestion: (id, suggestionId) =>
    ipcRenderer.invoke("suggestion:review", id, suggestionId),
  reviewReply: (id, messageId, recipientId) =>
    ipcRenderer.invoke("reply:review", id, messageId, recipientId),
  reviewRoutedReply: (id, messageId) =>
    ipcRenderer.invoke("reply:route-review", id, messageId),
  messageRoutingSettings: () => ipcRenderer.invoke("reply:settings"),
  planningSettings: () => ipcRenderer.invoke("planning:settings"),
  setPlanningSettings: (value) =>
    ipcRenderer.invoke("planning:settings:set", value),
  setMessageRoutingSettings: (value) =>
    ipcRenderer.invoke("reply:settings:set", value),
  answerMessage: (token, approved) =>
    ipcRenderer.invoke("reply:start", token, approved),
  reviewConsultation: (id, specialistId) =>
    ipcRenderer.invoke("consult:review", id, specialistId),
  startConsultation: (token, approved) =>
    ipcRenderer.invoke("consult:start", token, approved),
  stopConsultation: (id) => ipcRenderer.invoke("consult:stop", id),
  reviewAdvice: (id, consultationId, answers) =>
    ipcRenderer.invoke("advice:review", id, consultationId, answers),
  approveAdvice: (token, approved) =>
    ipcRenderer.invoke("advice:approve", token, approved),
  removeAdvice: (id, consultationId) =>
    ipcRenderer.invoke("advice:remove", id, consultationId),
  metrics: () => ipcRenderer.invoke("metrics:read"),
  prepareCorrection: (id, auditIndex, findingIndex, revision, key) =>
    ipcRenderer.invoke(
      "correction:prepare",
      id,
      auditIndex,
      findingIndex,
      revision,
      key,
    ),
  decideFinding: (id, decision) =>
    ipcRenderer.invoke("finding:decide", id, decision),
  startAudit: (id, kind, revision, approved) =>
    ipcRenderer.invoke("audit:start", id, kind, revision, approved),
  load: () => ipcRenderer.invoke("workspace:load"),
  taskActivity: (id) => ipcRenderer.invoke("task:activity", id),
  createTask: (input) => ipcRenderer.invoke("task:create", input),
  updateTask: (id, input) => ipcRenderer.invoke("task:update", id, input),
  deleteTask: (id) => ipcRenderer.invoke("task:delete", id),
  taskDisposition: (id) => ipcRenderer.invoke("task:disposition", id),
  archiveTask: (id) => ipcRenderer.invoke("task:archive", id),
  restoreTask: (id) => ipcRenderer.invoke("task:restore", id),
  permanentlyDeleteArchivedTask: (id, title) =>
    ipcRenderer.invoke("task:permanent-delete", id, title),
  updateTeammate: (input) => ipcRenderer.invoke("teammate:update", input),
  applyTeamStyle: (style) => ipcRenderer.invoke("teammate:style", style),
  saveTeam: (input) => ipcRenderer.invoke("team:save", input),
  setDefaultTeam: (id) => ipcRenderer.invoke("team:default", id),
  deleteTeam: (id) => ipcRenderer.invoke("team:delete", id),
  restoreTeam: (id) => ipcRenderer.invoke("team:restore", id),
  selectSource: () => ipcRenderer.invoke("source:select"),
  prepareRun: (taskId, sourceId, paths, workspaceMode) =>
    ipcRenderer.invoke("run:prepare", taskId, sourceId, paths, workspaceMode),
  chooseProjectWorkspace: (id) => ipcRenderer.invoke("project:choose", id),
  openProjectWorkspace: (id) => ipcRenderer.invoke("project:open", id),
  gitHistory: (id) => ipcRenderer.invoke("git:history", id),
  initializeGit: (id) => ipcRenderer.invoke("git:init", id),
  runs: (taskId) => ipcRenderer.invoke("run:list", taskId),
  usageForRun: (id) => ipcRenderer.invoke("usage:run", id),
  usageAlertsForRun: (id) => ipcRenderer.invoke("usage:alerts", id),
  costForRun: (id) => ipcRenderer.invoke("usage:cost", id),
  configureCost: (id, value) =>
    ipcRenderer.invoke("usage:cost:configure", id, value),
  configureUsageAlerts: (id, value) =>
    ipcRenderer.invoke("usage:alerts:configure", id, value),
  continueUsage: (id, pauseId) =>
    ipcRenderer.invoke("usage:continue", id, pauseId),
  saveTokensForRemaining: (id) => ipcRenderer.invoke("usage:save", id),
  session: () => ipcRenderer.invoke("session:info"),
  configureCoordination: (id, settings) =>
    ipcRenderer.invoke("coordination:configure", id, settings),
  configureSession: (value) => ipcRenderer.invoke("session:configure", value),
  listModels: () => ipcRenderer.invoke("session:models"),
  selectRunModel: (id, model) => ipcRenderer.invoke("run:model", id, model),
  selectDefaultModel: (model) => ipcRenderer.invoke("session:model", model),
  sendPlanningMessage: (id, text) =>
    ipcRenderer.invoke("room:planning-message", id, text),
  answerPlanningQuestion: (id, answer) =>
    ipcRenderer.invoke("room:planning-answer", id, answer),
  answerPlanningQuestions: (id, answerSet) =>
    ipcRenderer.invoke("room:planning-answers", id, answerSet),
  approvePlanningPlan: (id, revision, approved) =>
    ipcRenderer.invoke("room:planning-approve", id, revision, approved),
  retryPlanning: (id) => ipcRenderer.invoke("room:planning-retry", id),
  sendConversationMessage: (id, text, recipientId) =>
    ipcRenderer.invoke("room:conversation-message", id, text, recipientId),
  answerConversationMessage: (id, messageId, recipientId) =>
    ipcRenderer.invoke("room:conversation-answer", id, messageId, recipientId),
  answerBuildQuestion: (id, questionId, answer) =>
    ipcRenderer.invoke("room:build-answer", id, questionId, answer),
  reviewUsagePolicy: (id, choice) =>
    ipcRenderer.invoke("usage:review", id, choice),
  configureUsagePolicy: (id, choice, reviewToken) =>
    ipcRenderer.invoke("usage:configure", id, choice, reviewToken),
  startRun: (id, approved) => ipcRenderer.invoke("run:start", id, approved),
  approveLineup: (id, revision, entries, approved, core) =>
    ipcRenderer.invoke("lineup:approve", id, revision, entries, approved, core),
  stopRun: (id) => ipcRenderer.invoke("run:stop", id),
  requestRunPause: (id) => ipcRenderer.invoke("run:pause", id),
  resumeRunPause: (id, pauseId) =>
    ipcRenderer.invoke("run:resume-pause", id, pauseId),
  reviewApply: (id) => ipcRenderer.invoke("apply:review", id),
  applyDraft: (token, approved) =>
    ipcRenderer.invoke("apply:write", token, approved),
  inspectApplyRecovery: (runId, applicationId) =>
    ipcRenderer.invoke("apply:inspect", runId, applicationId),
  reviewExecution: (id, commandId) =>
    ipcRenderer.invoke("execution:review", id, commandId),
  executeCommand: (token, approved) =>
    ipcRenderer.invoke("execution:start", token, approved),
  stopExecution: (id) => ipcRenderer.invoke("execution:stop", id),
  decideCommand: (id, commandId, revision, decision) =>
    ipcRenderer.invoke("command:decide", id, commandId, revision, decision),
  onRun: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      run: import("../shared/runs").Run,
    ) => callback(run);
    ipcRenderer.on("run:update", listener);
    return () => ipcRenderer.removeListener("run:update", listener);
  },
};
const pearlApi = {
  webSearchInfo: api.webSearchInfo,
  configureWebSearch: api.configureWebSearch,
  disconnectWebSearch: api.disconnectWebSearch,
  listPearlChats: api.listPearlChats,
  createPearlChat: api.createPearlChat,
  getPearlChat: api.getPearlChat,
  sendPearlMessage: api.sendPearlMessage,
  choosePearlProject: api.choosePearlProject,
  approvePearlProject: api.approvePearlProject,
  decidePearlTool: api.decidePearlTool,
  answerPearlQuestion: api.answerPearlQuestion,
  retryPearlChat: api.retryPearlChat,
  stopPearlChat: api.stopPearlChat,
  onPearlChatUpdate: api.onPearlChatUpdate,
  session: api.session,
  configureSession: api.configureSession,
  metrics: api.metrics,
};
contextBridge.exposeInMainWorld("scully", pearlApi);
