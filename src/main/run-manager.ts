import { utilityProcess, type UtilityProcess } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "./store";
import { commandRevision } from "../engine/revision";
import { assessLocalCriterion } from "../shared/check-criteria";
import {
  parseMessage,
  parseAnswer,
  type ReplyReview,
  type TeamReply,
} from "../shared/messages";
import { noopSink, emitMetric, type MetricSink } from "../shared/telemetry";
import {
  recordFindingDecision,
  findingKey,
  findingCheckCurrent,
} from "../shared/audits";
import { snapshotRevision } from "../engine/integration";
import { suggestionsVisible } from "../shared/suggestions";
import {
  assertAuditKind,
  interruptAudits,
  type AuditKind,
} from "../shared/audits";
import {
  makeCoordination,
  isTestPath,
  parseCoordinationSettings,
} from "../shared/coordination";
import {
  validateSession,
  type Run,
  type SessionConfig,
  type SourceSelection,
} from "../shared/runs";
export class RunManager {
  private config: SessionConfig | null = null;
  private selection: SourceSelection | null = null;
  private active: {
    id: string;
    child: UtilityProcess;
  } | null = null;
  private activeReply: {
    id: string;
    child: UtilityProcess;
    replyId: string;
  } | null = null;
  private replyTicket: ReplyReview | null = null;
  constructor(
    private store: Store,
    private dataRoot: string,
    private publish: (run: Run) => void,
    private metricSink: MetricSink = noopSink,
  ) {
    store.recoverRuns();
  }
  session() {
    return {
      configured: !!this.config,
      model: this.config?.model || "",
      outputTokens: this.config?.outputTokens || 2048,
    };
  }
  reviewSuggestion(id: unknown, suggestionId: unknown) {
    const run = this.store.getRun(id);
    if (
      !suggestionsVisible(run.status) ||
      typeof suggestionId !== "string" ||
      !run.suggestions?.some((s) => s.id === suggestionId)
    )
      throw new Error("No completed suggestion to review");
    const updated = this.store.markSuggestionReviewed(run.id, suggestionId);
    this.publish(updated);
    return updated;
  }
  configureCoordination(id: unknown, value: unknown) {
    const run = this.store.getRun(id);
    if (run.status !== "prepared" || run.calls !== 0 || !run.coordination)
      throw new Error(
        "Coordination settings are locked once work starts. Prepare a new run.",
      );
    const { settings, rules } = parseCoordinationSettings(value);
    run.coordination.settings = settings;
    run.coordination.rules = rules;
    this.save(run);
    return run;
  }
  configure(value: unknown) {
    if (this.active || this.activeReply)
      throw new Error(
        "Wait for the active run before changing its provider settings",
      );
    this.config = validateSession(value);
    this.replyTicket = null;
    return this.session();
  }
  select(selection: SourceSelection) {
    this.selection = selection;
    return selection;
  }
  prepare(taskId: unknown, sourceId: unknown, paths: unknown): Run {
    const task = this.store.load().tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");
    if (
      !Array.isArray(paths) ||
      paths.length > 100 ||
      paths.some((p) => typeof p !== "string") ||
      new Set(paths).size !== paths.length
    )
      throw new Error("Invalid file selection");
    if (
      sourceId !== null &&
      (!this.selection || sourceId !== this.selection.id)
    )
      throw new Error("Select the source folder again");
    if (sourceId === null && paths.length)
      throw new Error("A new project cannot reference existing files");
    if (
      sourceId !== null &&
      (!paths.length ||
        paths.some((p) => !this.selection!.files.some((f) => f.path === p)))
    )
      throw new Error("Choose at least one available source file");
    const run: Run = {
      id: randomUUID(),
      taskId: task.id,
      sourceName: sourceId === null ? "New project" : this.selection!.name,
      files:
        sourceId === null
          ? []
          : this.selection!.files.filter((f) => paths.includes(f.path)),
      status: "prepared",
      events: [],
      plan: "",
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "",
      outputTokens: 0,
      coordination: makeCoordination(),
    };
    this.store.saveRun(run);
    return run;
  }
  private replyContext(id: unknown, messageId: unknown, recipientId?: unknown) {
    const run = this.store.getRun(id);
    if (
      this.activeReply ||
      (this.active && this.active.id !== run.id) ||
      run.redirectedTo ||
      ![
        "prepared",
        "planned",
        "complete",
        "planning",
        "building",
        "auditing",
      ].includes(run.status) ||
      run.executions?.some((e) => e.status === "running")
    )
      throw new Error("Wait for a stable, non-superseded task snapshot");
    if ((run.replies?.length || 0) >= 3)
      throw new Error("Three reply attempts per run maximum");
    const message = run.messages?.find(
      (m) => m.id === messageId && m.intent === "continue",
    );
    const workspace = this.store.load();
    const profile =
      recipientId === undefined
        ? undefined
        : workspace.teammates.find((t) => t.id === recipientId);
    if (recipientId !== undefined && !profile)
      throw new Error("Unknown reply recipient");
    const recipient = profile
      ? {
          id: profile.id,
          name: profile.name,
          role: profile.role,
          instructions: profile.instructions,
        }
      : undefined;
    const task = workspace.tasks.find((t) => t.id === run.taskId);
    if (!message || !task) throw new Error("Question not found");
    const context = JSON.stringify({
      progress: {
        status: run.status,
        assignments:
          run.coordination?.assignments.map((a) => ({
            owner: a.owner,
            scope: a.scope,
            status: a.status,
          })) || [],
      },
      recipient,
      question: message.text,
      task: { title: task.title, description: task.description },
      redirection: run.redirection?.instructions,
      plan: run.plan,
      selectedFiles: run.files,
      drafts: run.drafts,
      findings: run.findings,
    });
    if (Buffer.byteLength(context) > 85000)
      throw new Error("Reply snapshot exceeds the input limit");
    return { run, context, recipient };
  }
  reviewReply(id: unknown, messageId: unknown, recipientId?: unknown) {
    this.replyTicket = null;
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    const { run, context, recipient } = this.replyContext(
      id,
      messageId,
      recipientId,
    );
    const review: ReplyReview = {
      duringWork: ["planning", "building", "auditing"].includes(run.status),
      recipient,
      token: randomUUID(),
      runId: run.id,
      messageId: messageId as string,
      context,
      revision: createHash("sha256").update(context).digest("hex"),
      expiresAt: Date.now() + 120000,
      model: this.config.model,
      outputTokens: this.config.outputTokens,
    };
    this.replyTicket = review;
    return review;
  }
  answerMessage(token: unknown, approved: unknown) {
    const ticket = this.replyTicket;
    this.replyTicket = null;
    if (!ticket || ticket.token !== token)
      throw new Error("Review the question upload again");
    if (approved !== true)
      throw new Error("Fresh reply upload approval is required");
    if (
      !this.config ||
      ticket.model !== this.config.model ||
      ticket.outputTokens !== this.config.outputTokens ||
      Date.now() >= ticket.expiresAt
    )
      throw new Error("Reply review expired or settings changed");
    const { run, context } = this.replyContext(
      ticket.runId,
      ticket.messageId,
      ticket.recipient?.id,
    );
    const approvedContext = JSON.parse(ticket.context);
    const currentContext = JSON.parse(context);
    // During work, progress may advance, but the approved upload remains frozen.
    const identity = (value: typeof approvedContext) =>
      JSON.stringify({
        recipient: value.recipient,
        question: value.question,
        task: value.task,
        redirection: value.redirection,
        selectedFiles: value.selectedFiles,
      });
    if (
      ticket.duringWork
        ? identity(approvedContext) !== identity(currentContext)
        : context !== ticket.context
    )
      throw new Error("Reply snapshot changed. Review again.");
    const reply: TeamReply = {
      duringWork: ticket.duringWork,
      recipient: ticket.recipient,
      id: randomUUID(),
      messageId: ticket.messageId,
      revision: ticket.revision,
      status: "answering",
      answer: "",
      at: new Date().toISOString(),
    };
    const started = this.store.updateReply(run.id, reply);
    this.publish(started);
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
        serviceName: "Scully read-only reply",
        env: {},
        stdio: "ignore",
      });
    } catch {
      reply.status = "failed";
      reply.answer = "Could not start reply worker";
      const failed = this.store.updateReply(run.id, reply);
      this.publish(failed);
      return failed;
    }
    this.activeReply = { id: run.id, child, replyId: reply.id };
    child.on(
      "message",
      (message: { metric?: unknown; answer?: unknown; failed?: boolean }) => {
        if (this.activeReply?.child !== child) return;
        if (message.metric) {
          emitMetric(this.metricSink, message.metric);
          return;
        }
        try {
          if (message.failed) throw new Error("Reply worker failed");
          this.finishReply(
            run.id,
            reply.id,
            parseAnswer({ answer: message.answer }),
            false,
          );
        } catch {
          this.finishReply(
            run.id,
            reply.id,
            "Reply failed; no automatic retry.",
            true,
          );
        }
      },
    );
    child.on("exit", () => {
      if (this.activeReply?.child === child)
        this.finishReply(
          run.id,
          reply.id,
          "Reply worker exited; remote completion unconfirmed.",
          true,
        );
    });
    try {
      child.postMessage({ replyContext: ticket.context, config: this.config });
    } catch {
      return this.finishReply(
        run.id,
        reply.id,
        "Reply dispatch failed; remote completion unconfirmed.",
        true,
      );
    }
    return started;
  }
  private finishReply(
    id: string,
    replyId: string,
    answer: string,
    failed: boolean,
  ) {
    const child = this.activeReply?.child;
    this.activeReply = null;
    child?.kill();
    const current = this.store.getRun(id);
    const reply = current.replies?.find((r) => r.id === replyId);
    if (reply) {
      reply.status = failed ? "failed" : "answered";
      reply.answer = answer;
      const updated = this.store.updateReply(id, reply);
      this.publish(updated);
      return updated;
    }
    return current;
  }
  stopReply(id: unknown) {
    const run = this.store.getRun(id);
    if (this.activeReply?.id !== run.id) return run;
    return this.finishReply(
      run.id,
      this.activeReply.replyId,
      "Reply stopped locally; remote completion unconfirmed.",
      true,
    );
  }
  sendTeamMessage(id: unknown, value: unknown) {
    const input = parseMessage(value);
    let parent = this.store.getRun(id);
    if (parent.redirectedTo)
      throw new Error("This run was superseded. Open its revised attempt.");
    if ((parent.messages?.length || 0) >= 20)
      throw new Error("This run reached its 20-message limit");
    if (
      input.intent === "replan" &&
      (parent.executions?.some((e) => e.status === "running") ||
        (this.active && this.active.id !== parent.id))
    )
      throw new Error(
        "Stop active execution or other coordination before replanning",
      );
    if (
      input.intent === "replan" &&
      (parent.redirection?.instructions.length || 0) >= 3
    )
      throw new Error("Three redirections reached. Prepare a fresh task.");
    const message = {
      ...input,
      id: randomUUID(),
      at: new Date().toISOString(),
    };
    parent = this.store.appendMessage(parent.id, message);
    if (input.intent === "continue") {
      this.publish(parent);
      return parent;
    }
    if (this.active?.id === parent.id || this.activeReply?.id === parent.id)
      parent = this.stop(parent.id);
    const child: Run = {
      id: randomUUID(),
      taskId: parent.taskId,
      sourceName: parent.sourceName,
      files: structuredClone(parent.files),
      status: "prepared",
      events: [],
      plan: "",
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "",
      outputTokens: 0,
      coordination: makeCoordination(),
      redirection: {
        parentId: parent.id,
        instructions: [...(parent.redirection?.instructions || []), input.text],
        previousPlan: parent.plan,
        previousDrafts: structuredClone(parent.drafts),
      },
    };
    parent.redirectedTo = child.id;
    parent.status = "stopped";
    parent.events.push({
      actor: "system",
      at: message.at,
      text: "Superseded by a revised attempt. Old work is retained for inspection but cannot be executed or applied. Remote cancellation is unconfirmed.",
    });
    child.events.push({
      actor: "system",
      at: message.at,
      text: "Revised attempt prepared. Review redirection context and approve a new plan. No inherited execution, upload or apply permission.",
    });
    this.store.redirectRun(parent, child);
    this.publish(parent);
    this.publish(child);
    return child;
  }
  decideFinding(id: unknown, value: unknown) {
    const run = this.store.getRun(id);
    if (
      run.status !== "complete" ||
      run.executions?.some((e) => e.status === "running")
    )
      throw new Error("Wait for review and execution to finish");
    if (
      run.coordination?.integratedRevision !==
      snapshotRevision(run.files, run.drafts)
    )
      throw new Error("Draft changed. Review again.");
    const decision = recordFindingDecision(
      run,
      value,
      this.store.runs(run.taskId),
    );
    run.events.push({
      actor: "system",
      at: decision.at,
      text: `User marked specialist finding ${decision.findingIndex + 1} ${decision.decision}: ${decision.reason}. This is a user decision, not an automatic correctness verdict.`,
    });
    this.save(run);
    return run;
  }
  prepareCorrection(
    id: unknown,
    auditIndex: unknown,
    findingIndex: unknown,
    revision: unknown,
    key: unknown,
  ) {
    if (this.active) throw new Error("Wait for the active run");
    const parent = this.store.getRun(id);
    if (
      parent.status !== "complete" ||
      parent.correction ||
      parent.executions?.some((e) => e.status === "running")
    )
      throw new Error(
        "Choose a completed original draft with no running checks",
      );
    if (
      !Number.isInteger(auditIndex) ||
      (auditIndex as number) < 0 ||
      !Number.isInteger(findingIndex) ||
      (findingIndex as number) < 0
    )
      throw new Error("Invalid finding selection");
    const audit = parent.specialistAudits?.[auditIndex as number];
    const finding = audit?.findings[findingIndex as number];
    if (
      !finding ||
      audit?.revision !== revision ||
      findingKey(finding) !== key ||
      revision !== snapshotRevision(parent.files, parent.drafts) ||
      parent.coordination?.auditedRevision !== revision
    )
      throw new Error("Finding or draft is stale");
    if (
      this.store
        .runs(parent.taskId)
        .some((r) => r.correction?.parentId === parent.id)
    )
      throw new Error(
        "One corrective attempt per original run; review the existing attempt",
      );
    const parentFiles = new Map(
      [...parent.files, ...parent.drafts].map((file) => [
        file.path,
        file.content,
      ]),
    );
    const candidates = (parent.commands || []).flatMap((command) => {
      const testPaths = command.args.filter(
        (arg) => isTestPath(arg) && parentFiles.has(arg),
      );
      if (
        command.cwd !== "." ||
        testPaths.length !== 1 ||
        !command.findingLink?.criterion ||
        command.findingLink.auditIndex !== auditIndex ||
        command.findingLink.findingIndex !== findingIndex ||
        command.revision !== commandRevision(parent) ||
        !findingCheckCurrent(parent, command)
      )
        return [];
      return (parent.executions || [])
        .filter(
          (execution) =>
            assessLocalCriterion(command, execution).status === "not_met",
        )
        .map((execution) => ({ command, execution, testPath: testPaths[0] }));
    });
    const baseline = candidates.length === 1 ? candidates[0] : null;
    const child: Run = {
      id: randomUUID(),
      taskId: parent.taskId,
      sourceName: parent.sourceName,
      files: structuredClone(parent.files),
      status: "prepared",
      events: [],
      plan: parent.plan,
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model: "",
      outputTokens: 0,
      correction: {
        parentId: parent.id,
        parentRevision: revision as string,
        auditIndex: auditIndex as number,
        findingIndex: findingIndex as number,
        finding: structuredClone(finding),
        parentDrafts: structuredClone(parent.drafts),
        ...(baseline
          ? {
              recheck: {
                parentRunId: parent.id,
                parentCommandId: baseline.command.id,
                parentExecutionId: baseline.execution.id,
                parentCommandRevision: baseline.command.revision,
                testPath: baseline.testPath,
                testSha256: createHash("sha256")
                  .update(parentFiles.get(baseline.testPath)!)
                  .digest("hex"),
                criterion: structuredClone(
                  baseline.command.findingLink!.criterion!,
                ),
                command: {
                  executable: baseline.command.executable,
                  args: [...baseline.command.args],
                  cwd: baseline.command.cwd,
                  reason: baseline.command.reason,
                  timeoutSeconds: baseline.command.timeoutSeconds,
                },
              },
            }
          : {}),
      },
    };
    child.events.push({
      actor: "system",
      at: new Date().toISOString(),
      text: "Separate corrective attempt prepared. Original run, decisions and files retained. No upload or execution yet.",
    });
    this.save(child);
    return child;
  }
  startAudit(
    id: unknown,
    kind: unknown,
    revision: unknown,
    approved: unknown,
  ): Run {
    assertAuditKind(kind);
    return this.start(id, approved, { kind, revision });
  }
  start(
    id: unknown,
    approved: unknown,
    specialist?: { kind: AuditKind; revision: unknown },
  ): Run {
    if (approved !== true)
      throw new Error("Explicit upload and usage approval is required");
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    if (this.active) throw new Error("Another run is already active");
    const run = this.store.getRun(id);
    if (specialist) {
      if (
        run.status !== "complete" ||
        !run.drafts.length ||
        !run.coordination ||
        run.executions?.some((e) => e.status === "running")
      )
        throw new Error("Finish the draft and any execution before auditing");
      const revision = snapshotRevision(run.files, run.drafts);
      if (
        specialist.revision !== revision ||
        run.coordination.auditedRevision !== revision
      )
        throw new Error("Audit revision is stale");
      if ((run.specialistAudits?.length || 0) >= 3)
        throw new Error("Three specialist dispatches per run maximum");
    } else if (!["prepared", "planned"].includes(run.status))
      throw new Error("This run cannot be started again");
    const workspace = this.store.load();
    const task = workspace.tasks.find((t) => t.id === run.taskId);
    if (!task) throw new Error("Task not found");
    if (
      run.model &&
      (run.model !== this.config.model ||
        run.outputTokens !== this.config.outputTokens)
    )
      throw new Error(
        "Keep the approved run configuration unchanged or prepare a new run",
      );
    run.model = this.config.model;
    run.outputTokens = this.config.outputTokens;
    if (specialist) {
      run.specialistAudits ||= [];
      run.specialistAudits.push({
        kind: specialist.kind,
        revision: specialist.revision as string,
        status: "reviewing",
        calls: 0,
        summary: "",
        findings: [],
        response: "",
      });
    }
    mkdirSync(join(this.dataRoot, "drafts"), { recursive: true, mode: 0o700 });
    const queued: Run = {
      ...run,
      status: specialist
        ? "auditing"
        : !run.correction &&
            (task.mode === "plan" || !!run.redirection) &&
            !run.plan
          ? "planning"
          : "building",
    };
    this.save(queued);
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
        serviceName: "Scully task coordinator",
        env: {},
        stdio: "ignore",
      });
    } catch {
      queued.status = "failed";
      interruptAudits(queued);
      queued.error = "Could not start the task coordinator";
      this.save(queued);
      return queued;
    }
    this.active = { id: run.id, child };
    child.on(
      "message",
      (message: {
        run?: Run;
        done?: boolean;
        failed?: boolean;
        metric?: unknown;
      }) => {
        if (this.active?.child !== child) return;
        if (message.metric) {
          emitMetric(this.metricSink, message.metric);
          return;
        }
        if (message.failed) {
          this.fail(run.id, "The task coordinator failed");
          return;
        }
        if (message.run && message.run.id === run.id) {
          this.save(message.run);
          if (message.done) {
            this.active = null;
            child.kill();
          }
        }
      },
    );
    child.on("exit", () => {
      if (this.active?.child === child)
        this.fail(
          run.id,
          "The task coordinator exited unexpectedly. No automatic retry was made.",
        );
    });
    child.postMessage({
      specialist: !!specialist,
      run,
      task,
      team: workspace.teammates,
      config: this.config,
      outputRoot: join(this.dataRoot, "drafts", run.id),
    });
    return queued;
  }
  stop(id: unknown) {
    let run = this.store.getRun(id);
    const hadReply = this.activeReply?.id === run.id;
    if (hadReply) run = this.stopReply(run.id);
    if (this.replyTicket?.runId === run.id) this.replyTicket = null;
    if (hadReply && this.active?.id !== run.id) return run;
    if (this.active?.id !== run.id) throw new Error("This run is not active");
    const child = this.active.child;
    this.active = null;
    child.kill();
    run.status = "stopped";
    run.inFlightRequests = [];
    interruptAudits(run);
    for (const review of run.coordination?.chunkReviews || []) {
      if (review.status === "reviewing") {
        review.status = "failed";
        review.summary =
          "Review stopped locally; remote completion unconfirmed.";
      }
    }
    for (const assignment of run.coordination?.assignments || []) {
      if (assignment.status === "working") {
        assignment.status = "failed";
        assignment.summary =
          "Local coordination stopped. Remote completion is unconfirmed.";
      }
    }
    run.events.push({
      actor: "system",
      text: "Local coordination stopped. A remote inference request may still finish or consume credits.",
      at: new Date().toISOString(),
    });
    this.save(run);
    return run;
  }
  decideCommand(
    id: unknown,
    commandId: unknown,
    revision: unknown,
    decision: unknown,
  ) {
    const run = this.store.getRun(id);
    if (run.status !== "complete")
      throw new Error("Review a completed draft first");
    if (decision !== "approved" && decision !== "denied")
      throw new Error("Invalid command decision");
    const command = run.commands?.find((c) => c.id === commandId);
    if (!command) throw new Error("Command not found");
    if (revision !== command.revision || revision !== commandRevision(run))
      throw new Error("Draft or command changed. This approval is stale.");
    if (
      command.decision !== "pending" &&
      !(command.decision === "approved" && decision === "denied")
    )
      throw new Error("This proposal already has a decision");
    command.decision = decision;
    command.decidedAt = new Date().toISOString();
    run.events.push({
      actor: "system",
      at: command.decidedAt,
      text: `Command ${command.id.slice(0, 8)} ${decision} for draft ${command.revision.slice(0, 12)}. Decision recorded only; nothing executed.`,
    });
    this.save(run);
    return run;
  }
  close() {
    this.replyTicket = null;
    if (this.active) this.stop(this.active.id);
    if (this.activeReply) this.stopReply(this.activeReply.id);
    this.config = null;
  }
  private save(run: Run) {
    this.store.saveRun(run);
    this.publish(run);
  }
  private fail(id: string, error: string) {
    const run = this.store.getRun(id);
    const child = this.active?.child;
    this.active = null;
    child?.kill();
    run.status = "failed";
    run.inFlightRequests = [];
    interruptAudits(run);
    run.error = error;
    this.save(run);
  }
}
