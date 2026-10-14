import { utilityProcess, type UtilityProcess } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "./store";
import { validUsageStart, type UsageStart } from "../shared/usage";
import type { UsageAlert } from "../shared/usage-alerts";
import {
  chooseUsagePolicy,
  defaultUsagePolicy,
  expandsUsage,
  requiredCalls,
  type UsagePolicyChoice,
  type UsagePolicy,
} from "../shared/usage-policy";
import { requestLimit } from "../shared/coordination";
import { commandRevision, lineupPlanRevision } from "../engine/revision";
import { parseSpecialistLineup } from "../shared/lineup-proposal";
import {
  adviceForHandoff,
  approvedAdviceForBuild,
  type AdviceReview,
} from "../engine/advice-handoff";
import {
  parseConsultationResult,
  type ConsultationReview,
  type SpecialistConsultation,
} from "../shared/consultation";
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
import type { SavedTeam } from "../shared/teams";
export class RunManager {
  private config: SessionConfig | null = null;
  private selection: SourceSelection | null = null;
  private active: {
    id: string;
    child: UtilityProcess;
    acknowledged: number;
    limit: number;
    kind: "core" | "specialist";
    outputTokens: number;
    pendingOutputTokens?: number;
  } | null = null;
  private activeReply: {
    id: string;
    child: UtilityProcess;
    replyId: string;
    acknowledged: number;
    outputTokens: number;
  } | null = null;
  private activeConsult: {
    id: string;
    child: UtilityProcess;
    consultationId: string;
    acknowledged: number;
    outputTokens: number;
  } | null = null;
  private replyTicket: ReplyReview | null = null;
  private consultTicket: ConsultationReview | null = null;
  private handoffTicket: AdviceReview | null = null;
  private usageReview: {
    token: string;
    revision: string;
    expiresAt: number;
  } | null = null;
  private heldUsage = new Map<
    string,
    {
      runId: string;
      child: UtilityProcess;
      scope: "reply" | "consult" | "coordinator";
      value: UsageStart;
    }
  >();
  constructor(
    private store: Store,
    private dataRoot: string,
    private publish: (run: Run) => void,
    private metricSink: MetricSink = noopSink,
    private notifyUsageAlert: (alert: UsageAlert) => void = () => {},
  ) {
    store.recoverRuns();
  }
  private teamForRun(run: Run): SavedTeam {
    const assigned = this.store.teamForTask(run.taskId);
    if (
      run.teamSnapshot &&
      (run.teamSnapshot.id !== assigned.id ||
        run.teamSnapshot.name !== assigned.name ||
        run.teamSnapshot.version !== assigned.version ||
        run.teamSnapshot.createdAt !== assigned.createdAt ||
        JSON.stringify(run.teamSnapshot.members) !==
          JSON.stringify(assigned.members))
    )
      throw new Error("Saved run team does not match this task");
    return assigned;
  }
  private assertCoordinationTeam(run: Run, team: SavedTeam) {
    if (!run.coordination) return;
    const expected = makeCoordination(team.members);
    if (
      run.coordination.integrator !== expected.integrator ||
      run.coordination.auditor !== expected.auditor ||
      JSON.stringify(run.coordination.assignments.map(({ owner }) => owner)) !==
        JSON.stringify(expected.assignments.map(({ owner }) => owner))
    )
      throw new Error("Run coordination does not match its saved team");
  }
  usageAlertsForRun(id: unknown) {
    const run = this.store.getRun(id);
    return {
      ...this.store.alertsForRun(run.id),
      waiting: [...this.heldUsage.values()].some(
        (item) => item.runId === run.id,
      ),
    };
  }
  costForRun(id: unknown) {
    const run = this.store.getRun(id);
    return this.store.costForRun(run.id, run.model || this.config?.model || "");
  }
  configureCost(id: unknown, value: unknown) {
    const run = this.store.getRun(id);
    const snapshot = this.store.configureCost(
      run.id,
      run.model || this.config?.model || "",
      value,
    );
    this.publish(this.store.getRun(run.id));
    return snapshot;
  }
  configureUsageAlerts(id: unknown, value: unknown) {
    const updated = this.store.configureUsageAlerts(id, value);
    this.publish(this.store.getRun(id));
    return {
      ...updated,
      waiting: [...this.heldUsage.values()].some(
        (item) => item.runId === this.store.getRun(id).id,
      ),
    };
  }
  continueUsage(id: unknown, pauseId: unknown) {
    const run = this.store.getRun(id);
    const held = [...this.heldUsage.values()].find(
      (item) => item.runId === run.id,
    );
    if (!held || typeof pauseId !== "string")
      throw new Error("No active model request is waiting for review");
    if (
      !this.acknowledgeUsage(
        run.id,
        held.child,
        held.value,
        held.scope,
        pauseId,
      )
    )
      throw new Error("Usage review changed. Review the current pause again.");
    for (const next of this.heldUsage.values()) {
      if (next.runId === run.id) {
        this.acknowledgeUsage(run.id, next.child, next.value, next.scope);
        break;
      }
    }
    this.publish(this.store.getRun(run.id));
    return this.usageAlertsForRun(run.id);
  }
  saveTokensForRemaining(id: unknown) {
    const run = this.store.getRun(id);
    const active = this.active;
    if (!active || active.id !== run.id || active.kind !== "core")
      throw new Error("No active coordinator to lower future usage");
    const target = Math.min(active.outputTokens, 1024);
    if (target === active.outputTokens) return run;
    active.pendingOutputTokens = target;
    active.child.postMessage({ usageOutputTokens: target });
    return run;
  }
  private usageAlertSequence(runId: string) {
    return this.store.alertsForRun(runId).state.sequence;
  }
  private announceUsageAlert(runId: string, before: number) {
    const snapshot = this.store.alertsForRun(runId);
    if (
      snapshot.state.sequence > before &&
      snapshot.policy.delivery === "desktop" &&
      snapshot.state.latest
    ) {
      try {
        this.notifyUsageAlert(snapshot.state.latest);
      } catch {
        /* Local notification failure does not affect dispatch. */
      }
    }
  }
  private clearHeld(
    runId: string,
    scope?: "reply" | "consult" | "coordinator",
  ) {
    for (const [key, value] of this.heldUsage) {
      if (value.runId === runId && (!scope || value.scope === scope))
        this.heldUsage.delete(key);
    }
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
    this.usageReview = null;
    const run = this.store.getRun(id);
    if (run.status !== "prepared" || run.calls !== 0 || !run.coordination)
      throw new Error(
        "Coordination settings are locked once work starts. Prepare a new run.",
      );
    this.assertCoordinationTeam(run, this.teamForRun(run));
    const { settings, rules } = parseCoordinationSettings(
      value,
      run.coordination.assignments.map((assignment) => assignment.owner),
    );
    run.coordination.settings = settings;
    run.coordination.rules = rules;
    if (
      run.usagePolicy &&
      run.usagePolicy.earlyReviews !== settings.chunkReviews
    ) {
      const task = this.store
        .load()
        .tasks.find((item) => item.id === run.taskId);
      if (!task) throw new Error("Task not found");
      run.usagePolicy = {
        ...run.usagePolicy,
        preset: "custom",
        earlyReviews: settings.chunkReviews,
        requestCeiling:
          requiredCalls(run, task.mode) +
          (settings.chunkReviews ? run.coordination.assignments.length : 0),
      };
    }
    this.save(run);
    return run;
  }
  approveLineup(
    id: unknown,
    revision: unknown,
    entries: unknown,
    approved: unknown,
  ): Run {
    this.consultTicket = null;
    this.handoffTicket = null;
    if (approved !== true)
      throw new Error("Explicit lineup approval is required");
    if (this.active || this.activeReply || this.activeConsult)
      throw new Error("Wait for active work to finish");
    const run = this.store.getRun(id);
    if (run.status !== "planned" || !run.lineupProposal)
      throw new Error("No planned specialist lineup is awaiting review");
    const task = this.store.load().tasks.find((item) => item.id === run.taskId);
    if (
      !task ||
      !run.taskSnapshot ||
      run.taskSnapshot.title !== task.title ||
      run.taskSnapshot.description !== task.description ||
      run.taskSnapshot.mode !== task.mode ||
      revision !== run.lineupProposal.planRevision ||
      revision !== lineupPlanRevision(run, task)
    )
      throw new Error("Plan or task changed. Prepare and review a new lineup");
    const team = this.teamForRun(run);
    this.assertCoordinationTeam(run, team);
    const selected = parseSpecialistLineup(entries);
    run.approvedLineup = {
      planRevision: revision as string,
      entries: selected,
      approvedAt: new Date().toISOString(),
    };
    run.events.push({
      actor: "system",
      at: run.approvedLineup.approvedAt,
      text: `User approved ${selected.length} specialist ${selected.length === 1 ? "assignment" : "assignments"} for later review. No specialist request or budget change occurred.`,
    });
    this.store.saveRun(run);
    const updated = this.store.updateApprovedAdvice(run.id, []);
    this.publish(updated);
    return updated;
  }
  private consultationContext(id: unknown, specialistId: unknown) {
    const run = this.store.getRun(id);
    if (
      !["planned", "complete"].includes(run.status) ||
      run.redirectedTo ||
      !run.lineupProposal ||
      !run.approvedLineup ||
      this.active ||
      this.activeReply ||
      this.activeConsult
    )
      throw new Error("Wait for an approved, stable plan or completed draft");
    const task = this.store.load().tasks.find((item) => item.id === run.taskId);
    if (
      !task ||
      !run.taskSnapshot ||
      run.taskSnapshot.title !== task.title ||
      run.taskSnapshot.description !== task.description ||
      run.taskSnapshot.mode !== task.mode ||
      run.lineupProposal.planRevision !== lineupPlanRevision(run, task) ||
      run.approvedLineup.planRevision !== run.lineupProposal.planRevision
    )
      throw new Error("Plan or task changed. Review the lineup again");
    const team = this.teamForRun(run);
    this.assertCoordinationTeam(run, team);
    const entries = parseSpecialistLineup(run.approvedLineup.entries);
    const entry = entries.find((item) => item.id === specialistId);
    if (
      !entry ||
      (entry.phase !== "planning" && entry.phase !== "verification") ||
      (entry.phase === "planning" && run.status !== "planned") ||
      (entry.phase === "verification" && run.status !== "complete")
    )
      throw new Error("Choose a specialist approved for this phase");
    const phase: "planning" | "verification" =
      entry.phase === "planning" ? "planning" : "verification";
    if (run.consultations?.some((item) => item.specialistId === entry.id))
      throw new Error(
        "This specialist already received a consultation request for this run",
      );
    const artifactRevision =
      entry.phase === "verification"
        ? snapshotRevision(run.files, run.drafts)
        : undefined;
    if (
      entry.phase === "verification" &&
      (!run.drafts.length ||
        !run.coordination ||
        run.coordination.integratedRevision !== artifactRevision ||
        run.coordination.auditedRevision !== artifactRevision ||
        run.executions?.some((execution) => execution.status === "running") ||
        run.applications?.some(
          (application) => application.status === "applying",
        ))
    )
      throw new Error("Finish and audit the current draft before consultation");
    const context = JSON.stringify({
      specialistId: entry.id,
      phase: entry.phase,
      purpose: entry.purpose,
      task: { title: task.title, description: task.description },
      plan: run.plan,
      ...(entry.phase === "verification"
        ? {
            artifactRevision,
            drafts: run.drafts.map(({ path, content }) => ({ path, content })),
            audit: { checks: run.checks, findings: run.findings },
          }
        : {}),
    });
    if (Buffer.byteLength(context) > 80000)
      throw new Error("Specialist context exceeds the input limit");
    return { run, task, entry, phase, context, artifactRevision };
  }
  reviewConsultation(id: unknown, specialistId: unknown): ConsultationReview {
    this.consultTicket = null;
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    const { run, task, entry, phase, context, artifactRevision } =
      this.consultationContext(id, specialistId);
    const policy = this.checkedRunPolicy(run, task.mode);
    const cost = this.costForRun(run.id);
    const review: ConsultationReview = {
      token: randomUUID(),
      runId: run.id,
      specialistId: entry.id,
      phase,
      context,
      contextRevision: createHash("sha256").update(context).digest("hex"),
      planRevision: run.lineupProposal!.planRevision,
      artifactRevision,
      expiresAt: Date.now() + 120000,
      model: this.config.model,
      outputTokens: policy.outputTokens,
      projectedNanoUsd: cost.nextProjectedNanoUsd,
      rateStatus: cost.rateStatus,
    };
    this.consultTicket = review;
    return review;
  }
  startConsultation(token: unknown, approved: unknown): Run {
    const ticket = this.consultTicket;
    this.consultTicket = null;
    if (!ticket || ticket.token !== token)
      throw new Error("Review the specialist request again");
    if (approved !== true)
      throw new Error("Fresh specialist upload and usage approval is required");
    if (
      !this.config ||
      ticket.model !== this.config.model ||
      Date.now() >= ticket.expiresAt
    )
      throw new Error("Specialist review expired or model changed");
    const { run, task, entry, phase, context, artifactRevision } =
      this.consultationContext(ticket.runId, ticket.specialistId);
    const policy = this.checkedRunPolicy(run, task.mode);
    const cost = this.costForRun(run.id);
    if (
      ticket.outputTokens !== policy.outputTokens ||
      ticket.phase !== phase ||
      ticket.planRevision !== run.lineupProposal?.planRevision ||
      ticket.artifactRevision !== artifactRevision ||
      ticket.context !== context ||
      ticket.contextRevision !==
        createHash("sha256").update(context).digest("hex") ||
      ticket.projectedNanoUsd !== cost.nextProjectedNanoUsd ||
      ticket.rateStatus !== cost.rateStatus
    )
      throw new Error(
        "Specialist scope, cost or settings changed. Review again",
      );
    const consultation: SpecialistConsultation = {
      id: randomUUID(),
      specialistId: entry.id,
      phase,
      purpose: entry.purpose,
      planRevision: ticket.planRevision,
      artifactRevision,
      contextRevision: ticket.contextRevision,
      status: "consulting",
      advice: "",
      questions: [],
      at: new Date().toISOString(),
    };
    const started = this.store.updateConsultation(run.id, consultation);
    this.publish(started);
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
        serviceName: "Scully specialist consultation",
        env: {},
        stdio: "ignore",
      });
    } catch {
      return this.finishConsultation(run.id, consultation.id, null);
    }
    this.activeConsult = {
      id: run.id,
      child,
      consultationId: consultation.id,
      acknowledged: 0,
      outputTokens: ticket.outputTokens,
    };
    child.on(
      "message",
      (message: {
        metric?: unknown;
        usageStart?: unknown;
        usageFinish?: unknown;
        consultationStarted?: unknown;
        consultationResult?: unknown;
        failed?: boolean;
      }) => {
        if (this.activeConsult?.child !== child) return;
        if (message.metric) {
          emitMetric(this.metricSink, message.metric);
          return;
        }
        if (message.usageStart) {
          if (
            this.acknowledgeUsage(run.id, child, message.usageStart, "consult")
          )
            this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.usageFinish) {
          const before = this.usageAlertSequence(run.id);
          this.store.finishUsage(run.id, message.usageFinish, "consult");
          this.announceUsageAlert(run.id, before);
          this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.consultationStarted === true) {
          const current = this.store
            .getRun(run.id)
            .consultations?.find((item) => item.id === consultation.id);
          if (current?.status === "consulting" && !current.requestStartedAt) {
            current.requestStartedAt = new Date().toISOString();
            this.publish(this.store.updateConsultation(run.id, current));
          }
          return;
        }
        try {
          if (message.failed) throw new Error("Specialist worker failed");
          if (this.activeConsult?.acknowledged !== 1)
            throw new Error("Specialist request was not acknowledged");
          this.finishConsultation(
            run.id,
            consultation.id,
            parseConsultationResult(message.consultationResult),
          );
        } catch {
          this.finishConsultation(run.id, consultation.id, null);
        }
      },
    );
    child.on("exit", () => {
      if (this.activeConsult?.child === child)
        this.finishConsultation(run.id, consultation.id, null);
    });
    try {
      child.postMessage({
        consultContext: ticket.context,
        config: { ...this.config, outputTokens: ticket.outputTokens },
      });
    } catch {
      return this.finishConsultation(run.id, consultation.id, null);
    }
    return started;
  }
  private finishConsultation(
    id: string,
    consultationId: string,
    result: ReturnType<typeof parseConsultationResult> | null,
  ): Run {
    const child = this.activeConsult?.child;
    this.activeConsult = null;
    child?.kill();
    this.clearHeld(id, "consult");
    this.store.interruptUsage(id, "consult");
    const current = this.store.getRun(id);
    const consultation = current.consultations?.find(
      (item) => item.id === consultationId,
    );
    if (!consultation) return current;
    consultation.status = result ? "answered" : "failed";
    consultation.advice =
      result?.advice ||
      "Consultation failed or stopped; remote completion is unconfirmed. No automatic retry.";
    consultation.questions = result?.questions || [];
    const updated = this.store.updateConsultation(id, consultation);
    this.publish(updated);
    return updated;
  }
  stopConsultation(id: unknown): Run {
    const run = this.store.getRun(id);
    if (this.activeConsult?.id !== run.id) return run;
    return this.finishConsultation(
      run.id,
      this.activeConsult.consultationId,
      null,
    );
  }
  private adviceContext(id: unknown, consultationId: unknown) {
    const run = this.store.getRun(id);
    if (
      run.status !== "planned" ||
      run.redirectedTo ||
      this.active ||
      this.activeReply ||
      this.activeConsult ||
      typeof consultationId !== "string"
    )
      throw new Error("Wait for a stable, approved plan");
    const task = this.store.load().tasks.find((item) => item.id === run.taskId);
    if (
      !task ||
      !run.taskSnapshot ||
      run.taskSnapshot.title !== task.title ||
      run.taskSnapshot.description !== task.description ||
      run.taskSnapshot.mode !== task.mode
    )
      throw new Error("Task changed. Prepare and review a new plan");
    const team = this.teamForRun(run);
    this.assertCoordinationTeam(run, team);
    const { consultation, adviceRevision, handoff } = adviceForHandoff(
      run,
      task,
      consultationId,
    );
    if (
      run.approvedAdvice?.some((item) => item.consultationId === consultationId)
    )
      throw new Error("This advice is already attached to the build");
    approvedAdviceForBuild(run, task);
    if ((run.approvedAdvice?.length || 0) >= 3)
      throw new Error("Three specialist handoffs per build maximum");
    const text = JSON.stringify(handoff);
    return {
      run,
      task,
      consultation,
      adviceRevision,
      handoff: text,
      writerRequests: run.coordination?.assignments.length || 1,
    };
  }
  reviewAdvice(id: unknown, consultationId: unknown): AdviceReview {
    this.handoffTicket = null;
    const context = this.adviceContext(id, consultationId);
    const review: AdviceReview = {
      token: randomUUID(),
      runId: context.run.id,
      consultationId: context.consultation.id,
      planRevision: context.consultation.planRevision,
      adviceRevision: context.adviceRevision,
      handoff: context.handoff,
      inputBytes: Buffer.byteLength(context.handoff),
      writerRequests: context.writerRequests,
      expiresAt: Date.now() + 120000,
    };
    this.handoffTicket = review;
    return review;
  }
  approveAdvice(token: unknown, approved: unknown): Run {
    const ticket = this.handoffTicket;
    this.handoffTicket = null;
    if (!ticket || ticket.token !== token)
      throw new Error("Review the specialist handoff again");
    if (approved !== true)
      throw new Error("Explicit advice handoff approval is required");
    if (Date.now() >= ticket.expiresAt)
      throw new Error("Specialist handoff review expired");
    const context = this.adviceContext(ticket.runId, ticket.consultationId);
    if (
      ticket.planRevision !== context.consultation.planRevision ||
      ticket.adviceRevision !== context.adviceRevision ||
      ticket.handoff !== context.handoff ||
      ticket.inputBytes !== Buffer.byteLength(context.handoff) ||
      ticket.writerRequests !== context.writerRequests
    )
      throw new Error("Specialist advice or build scope changed. Review again");
    const updated = this.store.updateApprovedAdvice(context.run.id, [
      ...(context.run.approvedAdvice || []),
      {
        consultationId: context.consultation.id,
        specialistId: context.consultation.specialistId,
        planRevision: ticket.planRevision,
        adviceRevision: ticket.adviceRevision,
        approvedAt: new Date().toISOString(),
      },
    ]);
    this.publish(updated);
    return updated;
  }
  removeAdvice(id: unknown, consultationId: unknown): Run {
    const run = this.store.getRun(id);
    if (
      run.status !== "planned" ||
      this.active ||
      this.activeReply ||
      this.activeConsult ||
      typeof consultationId !== "string"
    )
      throw new Error("Wait for a stable plan to remove a handoff");
    const selected = run.approvedAdvice || [];
    if (!selected.some((item) => item.consultationId === consultationId))
      throw new Error("Specialist handoff not found");
    this.handoffTicket = null;
    const updated = this.store.updateApprovedAdvice(
      run.id,
      selected.filter((item) => item.consultationId !== consultationId),
    );
    this.publish(updated);
    return updated;
  }
  private proposedUsagePolicy(id: unknown, choice: unknown) {
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    const run = this.store.getRun(id);
    if (
      this.active ||
      this.activeReply ||
      this.activeConsult ||
      !["prepared", "planned"].includes(run.status)
    )
      throw new Error("Wait for a stable run before changing usage settings");
    const task = this.store.load().tasks.find((item) => item.id === run.taskId);
    if (!task) throw new Error("Task not found");
    const old =
      run.usagePolicy ||
      defaultUsagePolicy(
        run,
        task.mode,
        run.model || this.config.model,
        run.outputTokens || this.config.outputTokens,
      );
    const next = chooseUsagePolicy(
      run,
      task.mode,
      this.config.model,
      choice as UsagePolicyChoice,
    );
    if (run.calls > 0 && run.model && next.model !== run.model)
      throw new Error("Model cannot change after this run starts");
    if (
      next.requestCeiling <
      Math.max(run.calls, this.store.coreUsageRequests(run.id))
    )
      throw new Error("Request ceiling cannot be below calls already made");
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          runId: run.id,
          status: run.status,
          calls: run.calls,
          accountedCalls: this.store.coreUsageRequests(run.id),
          old,
          next,
          plan: run.plan,
          files: run.files,
        }),
      )
      .digest("hex");
    return { run, old, next, revision };
  }
  reviewUsagePolicy(id: unknown, choice: unknown) {
    this.usageReview = null;
    const { next, revision } = this.proposedUsagePolicy(id, choice);
    const token = randomUUID();
    this.usageReview = { token, revision, expiresAt: Date.now() + 120000 };
    return { token, policy: next };
  }
  configureUsagePolicy(id: unknown, choice: unknown, reviewToken: unknown) {
    const ticket = this.usageReview;
    this.usageReview = null;
    const { run, old, next, revision } = this.proposedUsagePolicy(id, choice);
    if (
      expandsUsage(old, next) &&
      (!ticket ||
        ticket.token !== reviewToken ||
        ticket.revision !== revision ||
        Date.now() >= ticket.expiresAt)
    )
      throw new Error("Review this usage increase again");
    run.usagePolicy = next;
    if (this.replyTicket?.runId === run.id) this.replyTicket = null;
    if (this.consultTicket?.runId === run.id) this.consultTicket = null;
    if (run.coordination) {
      run.coordination.settings = {
        ownership: run.coordination.settings?.ownership || "",
        chunkReviews: next.earlyReviews,
      };
    }
    this.save(run);
    return run;
  }
  configure(value: unknown) {
    if (this.active || this.activeReply || this.activeConsult)
      throw new Error(
        "Wait for the active run before changing its provider settings",
      );
    this.config = validateSession(value);
    this.replyTicket = null;
    this.consultTicket = null;
    this.usageReview = null;
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
    const assignedTeam = this.store.teamForTask(task.id);
    const run: Run = {
      id: randomUUID(),
      taskId: task.id,
      taskSnapshot: {
        title: task.title,
        description: task.description,
        mode: task.mode,
      },
      teamSnapshot: assignedTeam,
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
      coordination: makeCoordination(assignedTeam.members),
    };
    run.usagePolicy = defaultUsagePolicy(
      run,
      task.mode,
      this.config?.model || "",
      this.config?.outputTokens || 2048,
    );
    this.store.saveRun(run);
    return run;
  }
  private replyContext(id: unknown, messageId: unknown, recipientId?: unknown) {
    const run = this.store.getRun(id);
    if (
      this.activeReply ||
      this.activeConsult ||
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
    const team = this.teamForRun(run);
    this.assertCoordinationTeam(run, team);
    const profile =
      recipientId === undefined
        ? undefined
        : team.members.find((t) => t.id === recipientId);
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
    const task = this.store.load().tasks.find((item) => item.id === run.taskId);
    if (!task) throw new Error("Task not found");
    const policy = this.checkedRunPolicy(run, task.mode);
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
      outputTokens: policy.outputTokens,
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
      ticket.outputTokens !==
        (this.store.getRun(ticket.runId).usagePolicy?.outputTokens ||
          this.config.outputTokens) ||
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
    this.activeReply = {
      id: run.id,
      child,
      replyId: reply.id,
      acknowledged: 0,
      outputTokens: ticket.outputTokens,
    };
    child.on(
      "message",
      (message: {
        metric?: unknown;
        usageStart?: unknown;
        usageFinish?: unknown;
        replyStarted?: unknown;
        answer?: unknown;
        failed?: boolean;
      }) => {
        if (this.activeReply?.child !== child) return;
        if (message.metric) {
          emitMetric(this.metricSink, message.metric);
          return;
        }
        if (message.usageStart) {
          if (this.acknowledgeUsage(run.id, child, message.usageStart, "reply"))
            this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.usageFinish) {
          const before = this.usageAlertSequence(run.id);
          this.store.finishUsage(run.id, message.usageFinish, "reply");
          this.announceUsageAlert(run.id, before);
          this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.replyStarted === true) {
          const current = this.store.getRun(run.id);
          const waiting = current.replies?.find((r) => r.id === reply.id);
          if (waiting?.status === "answering" && !waiting.requestStartedAt) {
            waiting.requestStartedAt = new Date().toISOString();
            this.publish(this.store.updateReply(run.id, waiting));
          }
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
      child.postMessage({
        replyContext: ticket.context,
        config: { ...this.config, outputTokens: ticket.outputTokens },
      });
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
    this.clearHeld(id, "reply");
    this.store.interruptUsage(id, "reply");
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
    if (this.activeConsult?.id === parent.id)
      throw new Error(
        "Stop the specialist consultation before messaging the team",
      );
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
      teamSnapshot:
        parent.teamSnapshot || this.store.teamForTask(parent.taskId),
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
      coordination: makeCoordination(
        (parent.teamSnapshot || this.store.teamForTask(parent.taskId)).members,
      ),
      redirection: {
        parentId: parent.id,
        instructions: [...(parent.redirection?.instructions || []), input.text],
        previousPlan: parent.plan,
        previousDrafts: structuredClone(parent.drafts),
      },
    };
    child.usagePolicy = defaultUsagePolicy(
      child,
      "plan",
      this.config?.model || "",
      this.config?.outputTokens || 2048,
    );
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
      teamSnapshot:
        parent.teamSnapshot || this.store.teamForTask(parent.taskId),
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
    const task = this.store
      .load()
      .tasks.find((item) => item.id === parent.taskId);
    if (!task) throw new Error("Task not found");
    child.usagePolicy = defaultUsagePolicy(
      child,
      task.mode,
      this.config?.model || "",
      this.config?.outputTokens || 2048,
    );
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
    this.usageReview = null;
    if (approved !== true)
      throw new Error("Explicit upload and usage approval is required");
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    if (this.active || this.activeConsult)
      throw new Error("Another request is already active");
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
      run.taskSnapshot &&
      (run.taskSnapshot.title !== task.title ||
        run.taskSnapshot.description !== task.description ||
        run.taskSnapshot.mode !== task.mode)
    )
      throw new Error(
        "Task details changed. Prepare a new run before uploading.",
      );
    const team = this.teamForRun(run);
    this.assertCoordinationTeam(run, team);
    if (!specialist && run.status === "planned" && run.lineupProposal) {
      if (
        !run.approvedLineup ||
        run.lineupProposal.planRevision !== lineupPlanRevision(run, task) ||
        run.approvedLineup.planRevision !== run.lineupProposal.planRevision ||
        JSON.stringify(parseSpecialistLineup(run.approvedLineup.entries)) !==
          JSON.stringify(run.approvedLineup.entries)
      )
        throw new Error(
          "Review and approve the current specialist lineup before building",
        );
    }
    if (!specialist) approvedAdviceForBuild(run, task);
    run.teamSnapshot = team;
    run.usagePolicy = this.checkedRunPolicy(run, task.mode);
    if (
      !specialist &&
      this.store.coreUsageRequests(run.id) >= run.usagePolicy.requestCeiling
    )
      throw new Error("This run reached its saved request ceiling");
    run.model = this.config.model;
    run.outputTokens = run.usagePolicy.outputTokens;
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
    this.active = {
      id: run.id,
      child,
      acknowledged: 0,
      limit: specialist ? 2 : requestLimit(run),
      kind: specialist ? "specialist" : "core",
      outputTokens: run.usagePolicy.outputTokens,
    };
    child.on(
      "message",
      (message: {
        run?: Run;
        done?: boolean;
        failed?: boolean;
        metric?: unknown;
        usageStart?: unknown;
        usageFinish?: unknown;
        usageLimitApplied?: unknown;
      }) => {
        if (this.active?.child !== child) return;
        if (message.metric) {
          emitMetric(this.metricSink, message.metric);
          return;
        }
        if (message.usageLimitApplied !== undefined) {
          if (
            this.active?.pendingOutputTokens === message.usageLimitApplied &&
            Number.isSafeInteger(message.usageLimitApplied) &&
            (message.usageLimitApplied as number) <= this.active.outputTokens
          ) {
            this.active.outputTokens = message.usageLimitApplied as number;
            this.active.pendingOutputTokens = undefined;
            const current = this.store.getRun(run.id);
            if (current.usagePolicy) {
              current.usagePolicy = {
                ...current.usagePolicy,
                preset: "custom",
                outputTokens: this.active.outputTokens,
              };
              current.outputTokens = this.active.outputTokens;
              this.save(current);
            }
          }
          return;
        }
        if (message.usageStart) {
          if (
            this.acknowledgeUsage(
              run.id,
              child,
              message.usageStart,
              "coordinator",
            )
          )
            this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.usageFinish) {
          const before = this.usageAlertSequence(run.id);
          this.store.finishUsage(run.id, message.usageFinish, "coordinator");
          this.announceUsageAlert(run.id, before);
          this.publish(this.store.getRun(run.id));
          return;
        }
        if (message.failed) {
          this.fail(run.id, "The task coordinator failed");
          return;
        }
        if (message.run && message.run.id === run.id) {
          const approvedRun = this.store.getRun(run.id);
          message.run.usagePolicy = approvedRun.usagePolicy;
          message.run.model = approvedRun.model;
          message.run.outputTokens = approvedRun.outputTokens;
          message.run.teamSnapshot = approvedRun.teamSnapshot;
          message.run.approvedLineup = approvedRun.approvedLineup;
          if (approvedRun.approvedLineup)
            message.run.lineupProposal = approvedRun.lineupProposal;
          if (message.run.coordination && approvedRun.coordination) {
            message.run.coordination.settings =
              approvedRun.coordination.settings;
            message.run.coordination.rules = approvedRun.coordination.rules;
          }
          this.save(message.run);
          if (message.done) {
            this.active = null;
            child.kill();
            this.clearHeld(run.id, "coordinator");
            this.store.interruptUsage(run.id, "coordinator");
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
      team: team.members,
      config: { ...this.config, outputTokens: run.usagePolicy.outputTokens },
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
    this.clearHeld(run.id, "coordinator");
    this.store.interruptUsage(run.id, "coordinator");
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
    this.consultTicket = null;
    this.handoffTicket = null;
    this.usageReview = null;
    if (this.active) this.stop(this.active.id);
    if (this.activeReply) this.stopReply(this.activeReply.id);
    if (this.activeConsult) this.stopConsultation(this.activeConsult.id);
    this.config = null;
  }
  private checkedRunPolicy(run: Run, mode: "plan" | "work"): UsagePolicy {
    if (!this.config) throw new Error("Configure Nebius in Settings first");
    const policy =
      run.usagePolicy ||
      defaultUsagePolicy(
        run,
        mode,
        run.model || this.config.model,
        run.outputTokens || this.config.outputTokens,
      );
    const checked = chooseUsagePolicy(
      run,
      mode,
      policy.model || this.config.model,
      policy,
    );
    if (
      checked.outputTokens !== policy.outputTokens ||
      checked.requestCeiling !== policy.requestCeiling ||
      checked.earlyReviews !== policy.earlyReviews ||
      !!run.coordination?.settings?.chunkReviews !== policy.earlyReviews
    )
      throw new Error("Saved usage policy is invalid. Review it again");
    if (policy.model && policy.model !== this.config.model)
      throw new Error(
        "Configured model changed. Review and apply a run usage policy again",
      );
    if (run.model && run.model !== this.config.model)
      throw new Error("Keep this run's approved model unchanged");
    return { ...policy, model: this.config.model };
  }
  private acceptUsageStart(
    value: unknown,
    scope: "reply" | "consult" | "coordinator",
    expectedOutputTokens: number,
  ): value is UsageStart {
    return (
      validUsageStart(value) &&
      value.model === this.config?.model &&
      value.maxOutputTokens === expectedOutputTokens &&
      (scope === "reply"
        ? value.stage === "answer_question"
        : scope === "consult"
          ? value.stage === "consult_specialist"
          : value.stage !== "answer_question" &&
            value.stage !== "consult_specialist")
    );
  }
  private rejectUsage(child: UtilityProcess, value: unknown) {
    if (validUsageStart(value)) {
      this.heldUsage.delete(value.id);
      try {
        child.postMessage({ usageRejected: value.id });
      } catch {
        /* Worker may already have exited. */
      }
    }
  }
  private acknowledgeUsage(
    runId: string,
    child: UtilityProcess,
    value: unknown,
    scope: "reply" | "consult" | "coordinator",
    pauseId?: string,
  ) {
    try {
      const active =
        scope === "reply"
          ? this.activeReply
          : scope === "consult"
            ? this.activeConsult
            : this.active;
      if (
        !active ||
        active.child !== child ||
        (scope === "reply" || scope === "consult"
          ? active.acknowledged >= 1
          : this.active!.kind === "core"
            ? this.store.coreUsageRequests(runId) >= this.active!.limit
            : active.acknowledged >= this.active!.limit)
      ) {
        this.rejectUsage(child, value);
        return false;
      }
      if (
        !this.acceptUsageStart(
          value,
          scope,
          pauseId && validUsageStart(value) && this.heldUsage.has(value.id)
            ? value.maxOutputTokens
            : active.outputTokens,
        ) ||
        (scope === "coordinator" &&
          (this.active!.kind === "core"
            ? value.stage === "specialist_audit"
            : value.stage !== "specialist_audit"))
      ) {
        this.rejectUsage(child, value);
        return false;
      }
      const before = this.usageAlertSequence(runId);
      const result = this.store.reserveUsage(runId, value, pauseId);
      this.announceUsageAlert(runId, before);
      if (result === "paused") {
        this.heldUsage.set(value.id, { runId, child, scope, value });
        this.publish(this.store.getRun(runId));
        return false;
      }
      if (result !== "allowed") {
        if (pauseId === undefined) this.rejectUsage(child, value);
        return false;
      }
      this.heldUsage.delete(value.id);
      child.postMessage({ usageAcknowledged: value.id });
      active.acknowledged++;
      return true;
    } catch {
      this.rejectUsage(child, value);
      // The worker cannot dispatch without a durable acknowledgment.
      return false;
    }
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
    this.clearHeld(id, "coordinator");
    this.store.interruptUsage(id, "coordinator");
    run.status = "failed";
    run.inFlightRequests = [];
    interruptAudits(run);
    run.error = error;
    this.save(run);
  }
}
