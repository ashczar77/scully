import { createHash, randomUUID } from "node:crypto";
import { safePath, type SourceFile } from "./runs";

export type CollaborationMode = "sandbox" | "local";
export type CollaborationPermission = "read" | "edit" | "check" | "audit";
export type CollaborationStatus =
  "ready" | "running" | "waiting_user" | "waiting_peer" | "paused" | "finished";
export type CollaborationDiagnosticCode =
  | "provider_rejected"
  | "output_truncated"
  | "invalid_tool"
  | "permission_denied"
  | "sandbox_failure"
  | "submission_unknown"
  | "command_exit"
  | "integration_conflict"
  | "local_sync_conflict"
  | "no_progress"
  | "interrupted";
export type CollaborationEvent = {
  id: string;
  at: string;
  actor: string;
  recipient?: string;
  kind:
    | "message"
    | "question"
    | "decision"
    | "activity"
    | "checkpoint"
    | "check"
    | "diagnostic";
  text: string;
  revision: string;
  questionId?: string;
  checkpointId?: string;
  code?: CollaborationDiagnosticCode;
};
export type CollaborationQuestion = {
  id: string;
  owner: string;
  recipient: string;
  text: string;
  status: "pending" | "answered" | "withdrawn";
  askedAt: string;
  revision: string;
  resolutionEventId?: string;
};
export type CollaborationCheck = {
  id: string;
  actor: string;
  revision: string;
  command: string;
  args: string[];
  status: "running" | "passed" | "failed" | "unknown";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  at: string;
};
export type CollaborationCheckpoint = {
  id: string;
  actor: string;
  parentId: string | null;
  importedIds: string[];
  imageId: string | null;
  files: SourceFile[];
  checks: CollaborationCheck[];
  at: string;
  status: "published" | "integrated";
  sourceRevision?: string;
  actorImages?: Record<string, string>;
};
export type CollaborationOperation = {
  id: string;
  actor: string;
  stage: string;
  inputRevision: string;
  status: "pending" | "submitted" | "unknown" | "complete" | "failed";
  remoteId: string | null;
  resultImageId: string | null;
  at: string;
};
export type CollaborationMember = {
  id: string;
  name: string;
  role: string;
  permissions: CollaborationPermission[];
  status: CollaborationStatus;
  headId: string;
  model: string;
  thinking: "off" | "low" | "medium" | "high";
  thread: { role: "agent" | "tool" | "user"; text: string; at: string }[];
  lastAction?: string;
  repeatedActions: number;
  requestsSinceProgress?: number;
  invalidActionsSinceProgress?: number;
  assignment?: import("./planning-state").WorkAssignment;
  environment?: { mode: CollaborationMode; imageId: string | null };
};
export type CollaborationDecision = {
  id: string;
  version: number;
  text: string;
  eventId: string;
  at: string;
};
export type StaffingRequest = {
  id: string;
  requester: string;
  need: string;
  evidence: string;
  checkpointId: string;
  status: "open" | "proposed" | "resolved";
  at: string;
};
export type DispatchProposal = {
  id: string;
  requestId?: string;
  assignment: import("./planning-state").WorkAssignment;
  rationale: string;
  sourceHeadId: string;
  status: "pending" | "approved" | "declined";
  at: string;
};
export type CollaborationScope = {
  projectPath: string;
  projectDev: number;
  projectIno: number;
  projectId: string;
  mode: CollaborationMode;
  baseImageId: string | null;
  memberEnvironments?: Record<
    string,
    {
      mode: CollaborationMode;
      imageId: string | null;
      tools: string[];
      reason: string;
      localApproved?: boolean;
    }
  >;
  manifest: { path: string; sha256: string; bytes: number }[];
  allowedCommands: string[];
  approvedAt: string;
};
export type Collaboration = {
  version: 1;
  taskId: string;
  status: "ready" | "running" | "paused" | "review" | "complete";
  scope: CollaborationScope;
  baseId: string;
  baseImageId: string | null;
  prepared: boolean;
  checkpoints: CollaborationCheckpoint[];
  members: CollaborationMember[];
  events: CollaborationEvent[];
  questions: CollaborationQuestion[];
  decisions: CollaborationDecision[];
  staffingRequests?: StaffingRequest[];
  dispatchProposals?: DispatchProposal[];
  operations: CollaborationOperation[];
  integration: {
    headId: string;
    sourceHeads: Record<string, string>;
    conflicts: string[];
  };
  auditedHeadId: string | null;
  audits?: { actor: string; headId: string; text: string; at: string }[];
  synchronizedHeadId: string | null;
};

export function fileRevision(files: readonly SourceFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    safePath(file.path);
    hash.update(file.path).update("\0").update(file.content).update("\0");
  }
  return hash.digest("hex");
}
export function manifestFor(files: readonly SourceFile[]) {
  return files.map((file) => {
    safePath(file.path);
    return {
      path: file.path,
      sha256: createHash("sha256").update(file.content).digest("hex"),
      bytes: Buffer.byteLength(file.content),
    };
  });
}
function stamp(now: () => Date) {
  return now().toISOString();
}
export function createCollaboration(
  taskId: string,
  scope: CollaborationScope,
  files: SourceFile[],
  members: Omit<
    CollaborationMember,
    "status" | "headId" | "thread" | "repeatedActions"
  >[],
  now: () => Date = () => new Date(),
): Collaboration {
  if (
    !taskId ||
    !members.length ||
    new Set(members.map((m) => m.id)).size !== members.length
  )
    throw new Error("Invalid collaboration team");
  if (JSON.stringify(manifestFor(files)) !== JSON.stringify(scope.manifest))
    throw new Error("Upload manifest changed before approval");
  const baseId = fileRevision(files);
  const base: CollaborationCheckpoint = {
    id: baseId,
    actor: "project",
    parentId: null,
    importedIds: [],
    imageId: scope.baseImageId,
    files: structuredClone(files),
    checks: [],
    at: stamp(now),
    status: "published",
  };
  return {
    version: 1,
    taskId,
    status: "ready",
    scope,
    baseId,
    baseImageId: scope.baseImageId,
    prepared: false,
    checkpoints: [base],
    members: members.map((member) => ({
      ...member,
      status: "ready",
      headId: baseId,
      thread: [],
      repeatedActions: 0,
      requestsSinceProgress: 0,
    })),
    events: [],
    questions: [],
    decisions: [],
    staffingRequests: [],
    dispatchProposals: [],
    operations: [],
    integration: { headId: baseId, sourceHeads: {}, conflicts: [] },
    auditedHeadId: null,
    audits: [],
    synchronizedHeadId: null,
  };
}
export function checkpoint(state: Collaboration, id: string) {
  const found = state.checkpoints.find((item) => item.id === id);
  if (!found) throw new Error("Checkpoint is missing");
  return found;
}
export function member(state: Collaboration, actor: string) {
  const found = state.members.find((item) => item.id === actor);
  if (!found) throw new Error("Teammate is outside the approved scope");
  return found;
}

export function startMemberBranch(
  state: Collaboration,
  actor: string,
  imageId: string | null,
  now: () => Date = () => new Date(),
) {
  const owner = member(state, actor);
  if (
    owner.headId !== state.baseId ||
    state.checkpoints.some((item) => item.actor === actor)
  )
    throw new Error("Teammate branch has already started");
  const base = checkpoint(state, state.baseId);
  const id = createHash("sha256")
    .update(state.baseId)
    .update("\0")
    .update(actor)
    .update("\0")
    .update(imageId || "local")
    .digest("hex");
  const branch: CollaborationCheckpoint = {
    id,
    actor,
    parentId: state.baseId,
    importedIds: [],
    imageId,
    files: structuredClone(base.files),
    checks: [],
    at: stamp(now),
    status: "published",
    sourceRevision: state.baseId,
  };
  state.checkpoints.push(branch);
  owner.headId = id;
  appendEvent(
    state,
    {
      actor,
      kind: "checkpoint",
      text: "Prepared an independent work branch",
      revision: id,
      checkpointId: id,
    },
    now,
  );
  return branch;
}
export function startDispatchedBranch(
  state: Collaboration,
  actor: string,
  sourceHeadId: string,
  imageId: string | null,
  now: () => Date = () => new Date(),
) {
  const owner = member(state, actor);
  if (owner.headId !== sourceHeadId) throw new Error("Dispatch source changed");
  const source = checkpoint(state, sourceHeadId);
  const id = createHash("sha256")
    .update(sourceHeadId)
    .update("\0")
    .update(actor)
    .update("\0")
    .update(imageId || "local")
    .digest("hex");
  const branch: CollaborationCheckpoint = {
    id,
    actor,
    parentId: sourceHeadId,
    importedIds: [],
    imageId,
    files: structuredClone(source.files),
    checks: [],
    at: stamp(now),
    status: "published",
    sourceRevision: sourceHeadId,
  };
  state.checkpoints.push(branch);
  owner.headId = id;
  state.integration.sourceHeads[actor] = sourceHeadId;
  appendEvent(
    state,
    {
      actor,
      kind: "checkpoint",
      text: "Prepared a branch from the reviewed checkpoint",
      revision: id,
      checkpointId: id,
    },
    now,
  );
  return branch;
}
export function requirePermission(
  state: Collaboration,
  actor: string,
  permission: CollaborationPermission,
) {
  if (!member(state, actor).permissions.includes(permission))
    throw new Error(`Permission denied for ${actor}: ${permission}`);
}
export function appendEvent(
  state: Collaboration,
  value: Omit<CollaborationEvent, "id" | "at">,
  now: () => Date = () => new Date(),
) {
  if (
    value.actor !== "user" &&
    value.actor !== "system" &&
    value.actor !== "project"
  )
    member(state, value.actor);
  if (value.recipient && value.recipient !== "user")
    member(state, value.recipient);
  const event = { ...value, id: randomUUID(), at: stamp(now) };
  state.events.push(event);
  return event;
}
export function sendCollaborationMessage(
  state: Collaboration,
  actor: string,
  recipient: string | undefined,
  text: string,
  revision: string,
  questionId?: string,
  now: () => Date = () => new Date(),
) {
  if (typeof text !== "string" || !text.trim() || text.length > 20_000)
    throw new Error("Enter a message");
  if (actor !== "user") member(state, actor);
  if (recipient && recipient !== "user") member(state, recipient);
  if (actor !== "user" && member(state, actor).headId !== revision)
    throw new Error("Message revision is stale");
  let question: CollaborationQuestion | undefined;
  if (questionId) {
    question = state.questions.find((item) => item.id === questionId);
    if (
      !question ||
      question.status !== "pending" ||
      question.recipient !== actor ||
      question.owner !== recipient
    )
      throw new Error(
        "Question is missing, resolved, or addressed to another teammate",
      );
  }
  const event = appendEvent(
    state,
    { actor, recipient, text, revision, kind: "message", questionId },
    now,
  );
  if (question) {
    question.status = "answered";
    question.resolutionEventId = event.id;
    if (question.owner !== "user")
      member(state, question.owner).status = "ready";
  }
  return event;
}
export function askCollaborationQuestion(
  state: Collaboration,
  actor: string,
  recipient: string,
  text: string,
  revision: string,
  now: () => Date = () => new Date(),
) {
  member(state, actor);
  if (recipient !== "user") member(state, recipient);
  if (
    recipient === actor ||
    member(state, actor).headId !== revision ||
    !text.trim()
  )
    throw new Error("Invalid question or stale revision");
  const event = appendEvent(
    state,
    { actor, recipient, text, revision, kind: "question" },
    now,
  );
  const question: CollaborationQuestion = {
    id: randomUUID(),
    owner: actor,
    recipient,
    text,
    status: "pending",
    askedAt: event.at,
    revision,
  };
  event.questionId = question.id;
  state.questions.push(question);
  member(state, actor).status =
    recipient === "user" ? "waiting_user" : "waiting_peer";
  return question;
}
export function reviseCollaborationDecision(
  state: Collaboration,
  text: string,
  eventId: string,
  now: () => Date = () => new Date(),
) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event || event.actor !== "user" || !text.trim())
    throw new Error("Decision needs a user message");
  const decision = {
    id: randomUUID(),
    version: state.decisions.length + 1,
    text,
    eventId,
    at: stamp(now),
  };
  state.decisions.push(decision);
  for (const person of state.members)
    if (person.status === "finished") person.status = "ready";
  return decision;
}
export function changeBranchFile(
  state: Collaboration,
  actor: string,
  expectedHead: string,
  path: string,
  content: string,
  now: () => Date = () => new Date(),
) {
  requirePermission(state, actor, "edit");
  safePath(path);
  if (typeof content !== "string" || content.includes("\0"))
    throw new Error("Invalid file content");
  const owner = member(state, actor);
  if (owner.headId !== expectedHead)
    throw new Error("Branch revision is stale");
  const parent = checkpoint(state, expectedHead);
  const files = new Map(parent.files.map((item) => [item.path, item.content]));
  if (files.get(path) === content) return parent;
  files.set(path, content);
  const nextFiles = [...files].map(([name, body]) => ({
    path: name,
    content: body,
  }));
  const id = createHash("sha256")
    .update(actor)
    .update(expectedHead)
    .update(fileRevision(nextFiles))
    .digest("hex");
  const next: CollaborationCheckpoint = {
    id,
    actor,
    parentId: expectedHead,
    importedIds: [],
    imageId: null,
    files: nextFiles,
    checks: [],
    at: stamp(now),
    status: "published",
  };
  state.checkpoints.push(next);
  owner.headId = id;
  state.auditedHeadId = null;
  appendEvent(
    state,
    {
      actor,
      kind: "checkpoint",
      text: `Changed ${path}`,
      revision: id,
      checkpointId: id,
    },
    now,
  );
  return next;
}
export function attachCheckpointImage(
  state: Collaboration,
  actor: string,
  headId: string,
  imageId: string,
) {
  if (member(state, actor).headId !== headId)
    throw new Error("Branch advanced before image verification");
  checkpoint(state, headId).imageId = imageId;
}
export function integrateCollaboration(
  state: Collaboration,
  actor: string,
  now: () => Date = () => new Date(),
) {
  requirePermission(state, actor, "edit");
  const merged = new Map(
    checkpoint(state, state.integration.headId).files.map((file) => [
      file.path,
      file.content,
    ]),
  );
  const sourceHeads = { ...state.integration.sourceHeads };
  const conflicts: string[] = [];
  const importedIds: string[] = [];
  let changed = false;
  for (const person of state.members.filter((item) =>
    item.permissions.includes("edit"),
  )) {
    if (sourceHeads[person.id] === person.headId) continue;
    const branch = checkpoint(state, person.headId);
    const previous = sourceHeads[person.id]
      ? checkpoint(state, sourceHeads[person.id])
      : checkpoint(state, state.baseId);
    const previousFiles = new Map(
      previous.files.map((file) => [file.path, file.content]),
    );
    for (const file of branch.files) {
      const original = previousFiles.get(file.path);
      if (original === file.content) continue;
      const current = merged.get(file.path);
      if (current !== original && current !== file.content) {
        conflicts.push(
          `${file.path}: ${person.id} ${person.headId} conflicts with integration ${state.integration.headId}`,
        );
        continue;
      }
      merged.set(file.path, file.content);
      changed = true;
    }
    importedIds.push(person.headId);
    sourceHeads[person.id] = person.headId;
  }
  state.integration.conflicts = conflicts;
  if (conflicts.length) {
    appendEvent(
      state,
      {
        actor: "system",
        kind: "diagnostic",
        code: "integration_conflict",
        text: conflicts.join("\n"),
        revision: state.integration.headId,
      },
      now,
    );
    return { headId: state.integration.headId, conflicts };
  }
  const files = [...merged].map(([path, content]) => ({ path, content }));
  const id = changed
    ? createHash("sha256")
        .update(state.integration.headId)
        .update(fileRevision(files))
        .digest("hex")
    : state.integration.headId;
  if (changed) {
    state.checkpoints.push({
      id,
      actor,
      parentId: state.integration.headId,
      importedIds,
      imageId: null,
      files,
      checks: [],
      at: stamp(now),
      status: "integrated",
    });
    state.integration.headId = id;
    state.auditedHeadId = null;
    appendEvent(
      state,
      {
        actor,
        kind: "checkpoint",
        text: "Integrated published branch changes",
        revision: id,
        checkpointId: id,
      },
      now,
    );
  }
  state.integration.sourceHeads = sourceHeads;
  return { headId: id, conflicts: [] };
}
export function dispatchCollaborationMember(
  state: Collaboration,
  value: Omit<
    CollaborationMember,
    "status" | "headId" | "thread" | "repeatedActions"
  >,
  fromHead: string,
) {
  if (state.members.some((item) => item.id === value.id))
    throw new Error("Teammate is already active");
  checkpoint(state, fromHead);
  const teammate: CollaborationMember = {
    ...value,
    status: "ready",
    headId: fromHead,
    thread: [],
    repeatedActions: 0,
  };
  state.members.push(teammate);
  return teammate;
}
