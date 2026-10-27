import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  sandboxClient,
  SandboxRequestError,
  SandboxWorkspaceMissingError,
} from "../engine/sandbox";
import type { CloudConfig } from "../shared/cloud";
import type { PearlChat } from "../shared/pearl-chat";
import type {
  PearlSandboxBranch,
  PearlSandboxConnection,
  PearlSandboxImageList,
  PearlSandboxManifestFile,
  PearlSandboxState,
  PearlSandboxSnapshot,
} from "../shared/pearl-sandbox";
import type { CollaborationOperation } from "../shared/collaboration";
import type {
  FileReview,
  TaskChangeSet,
  TaskFileChange,
} from "../shared/pearl-workspace";
import {
  containsSecret,
  safePath,
  type DraftFile,
  type ProjectWorkspace,
} from "../shared/runs";
import {
  sandboxCollaborationWorkspace,
  type CollaborationWorkspace,
} from "./collaboration-workspace";
import { writeProjectTransaction } from "./pearl-file-transaction";
import { blockedProjectPart, candidateFiles } from "./pearl-project-map";
import {
  inspectProjectFile,
  verifyProjectRoot,
  writeProjectWorkspace,
} from "./project-workspace";

type Client = ReturnType<typeof sandboxClient>;
type Baseline = { projectPath: string; files: Record<string, string> };
const maxFiles = 20_000;
const maxBytes = 256 * 1024 * 1024;
const maxFileBytes = 64 * 1024 * 1024;
const maxChangedFiles = 100;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeSourcePath(path: unknown): asserts path is string {
  safePath(path);
  if ((path as string).split("/").some(blockedProjectPart))
    throw new Error("Unsupported or private project path for Sandbox");
}
function branch(state: PearlSandboxState): PearlSandboxBranch {
  const selected = state.branches.find(
    (item) => item.id === state.activeBranchId,
  );
  if (state.status !== "ready" || !selected)
    throw new Error("Start and select a Sandbox branch first");
  return selected;
}
function binding(chat: PearlChat): ProjectWorkspace {
  if (!chat.project?.approved)
    throw new Error("Approve the project folder first");
  const bound = { ...chat.project, kind: "existing" as const };
  verifyProjectRoot(bound);
  return bound;
}

export class PearlSandboxService {
  private config: CloudConfig | null = null;
  private catalog = new Map<string, string>();
  private recordOperation(
    state: PearlSandboxState,
    operation: CollaborationOperation,
    path?: string,
  ): void {
    state.lastOperation = {
      stage: operation.stage,
      status: operation.status,
      remoteId: operation.remoteId,
    };
    const entry = {
      stage: operation.stage,
      status: operation.status,
      remoteId: operation.remoteId,
      resultImageId: operation.resultImageId,
      path,
      at: operation.at,
    };
    state.operations ||= [];
    const index = state.operations.findIndex(
      (item) =>
        item.remoteId &&
        item.remoteId === operation.remoteId &&
        item.stage === operation.stage,
    );
    if (index < 0) state.operations.push(entry);
    else state.operations[index] = entry;
    state.operations = state.operations.slice(-80);
  }
  constructor(
    private readonly dataRoot: string,
    private readonly clientFactory: typeof sandboxClient = sandboxClient,
    private readonly workspaceFactory: (
      client: Client,
    ) => CollaborationWorkspace = sandboxCollaborationWorkspace,
  ) {}

  connection(): PearlSandboxConnection {
    return {
      configured: Boolean(this.config),
      projectId: this.config?.projectId || "",
    };
  }
  configure(key: unknown, projectId: unknown): PearlSandboxConnection {
    if (typeof key !== "string" || typeof projectId !== "string")
      throw new Error("Enter a Sandbox API key and project ID");
    this.clientFactory({ key, projectId });
    this.config = { key, projectId };
    this.catalog.clear();
    return this.connection();
  }
  async images(): Promise<PearlSandboxImageList> {
    const result = await this.client().images("");
    this.catalog = new Map(
      result.images.map((image) => [image.uuid, image.tag || image.uuid]),
    );
    return result;
  }
  private client(projectId?: string): Client {
    if (!this.config) throw new Error("Connect to Nebius Sandbox in Settings");
    if (projectId && this.config.projectId !== projectId)
      throw new Error(
        "This chat uses a different Nebius Sandbox project. Connect that project in Settings",
      );
    return this.clientFactory(this.config);
  }
  private baselinePath(chat: PearlChat): string {
    if (!/^[0-9a-f-]{36}$/i.test(chat.id))
      throw new Error("Invalid Sandbox chat ID");
    return join(this.dataRoot, "pearl-sandboxes", chat.id, "baseline.json");
  }
  remove(chat: PearlChat): void {
    rmSync(dirname(this.baselinePath(chat)), { recursive: true, force: true });
  }
  private saveBaseline(chat: PearlChat, value: Baseline): void {
    const target = this.baselinePath(chat);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.next`;
    writeFileSync(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, target);
  }
  private baseline(chat: PearlChat): Baseline {
    const state = chat.sandbox;
    if (!state || !existsSync(this.baselinePath(chat)))
      throw new Error("Sandbox source snapshot is unavailable");
    const value = JSON.parse(
      readFileSync(this.baselinePath(chat), "utf8"),
    ) as Baseline;
    if (
      value.projectPath !== state.projectPath ||
      hash(JSON.stringify(value.files)) !== state.baseDigest
    )
      throw new Error(
        "Sandbox source snapshot changed; do not continue this branch",
      );
    return value;
  }
  private snapshot(project: ProjectWorkspace): {
    files: Record<string, string>;
    manifest: PearlSandboxManifestFile[];
    excluded: string[];
  } {
    const candidates = candidateFiles(project, maxFiles);
    if (candidates.truncated || candidates.paths.length > maxFiles)
      throw new Error(
        "This project exceeds the Sandbox snapshot limit of 20,000 files",
      );
    const files: Record<string, string> = {};
    const manifest: PearlSandboxManifestFile[] = [];
    const excluded: string[] = [];
    let total = 0;
    for (const path of candidates.paths) {
      try {
        safeSourcePath(path);
        const stat = lstatSync(join(project.path, path));
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFileBytes)
          throw new Error("Unsupported file");
        const content = inspectProjectFile(project, path);
        if (
          content === null ||
          content.includes("\0") ||
          containsSecret(content)
        )
          throw new Error("Private or unsupported content");
        const bytes = Buffer.byteLength(content);
        total += bytes;
        if (total > maxBytes)
          throw new Error("Sandbox snapshot exceeds 256 MB");
        files[path] = content;
        manifest.push({ path, bytes, sha256: hash(content) });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Sandbox snapshot exceeds 256 MB"
        )
          throw error;
        excluded.push(path);
      }
    }
    if (!manifest.length)
      throw new Error("No eligible project files can be uploaded");
    return { files, manifest, excluded };
  }
  prepare(chat: PearlChat, imageId: unknown): PearlChat {
    const project = binding(chat);
    if (chat.status === "running" || chat.status === "awaiting_approval")
      throw new Error("Wait for Pearl's current action");
    if (
      chat.sandbox?.status === "ready" ||
      chat.sandbox?.status === "uploading"
    )
      throw new Error(
        "Finish or leave the current Sandbox before preparing another",
      );
    if (typeof imageId !== "string" || !this.catalog.has(imageId))
      throw new Error("Choose an image from the current Sandbox catalog");
    const client = this.client();
    void client;
    const source = this.snapshot(project);
    const baseDigest = hash(JSON.stringify(source.files));
    this.saveBaseline(chat, { projectPath: project.path, files: source.files });
    chat.sandbox = {
      status: "prepared",
      active: false,
      projectId: this.config!.projectId,
      projectPath: project.path,
      baseImage: imageId,
      baseImageTag: this.catalog.get(imageId),
      baseDigest,
      manifest: source.manifest,
      excluded: source.excluded,
      branches: [],
    };
    return chat;
  }
  async start(chat: PearlChat, publish: () => void): Promise<PearlChat> {
    const state = chat.sandbox;
    if (!state || state.status !== "prepared")
      throw new Error("Prepare and review a Sandbox snapshot first");
    const project = binding(chat);
    const fresh = this.snapshot(project);
    if (
      project.path !== state.projectPath ||
      hash(JSON.stringify(fresh.files)) !== state.baseDigest
    )
      throw new Error(
        "Project files changed since the upload review. Prepare again.",
      );
    const source = this.baseline(chat);
    const client = this.client(state.projectId);
    state.lastOperation = undefined;
    state.status = "uploading";
    state.uploadProgress = {
      phase: "preparing",
      uploadedBytes: 0,
      totalBytes: state.manifest.reduce((sum, file) => sum + file.bytes, 0),
      completedFiles: 0,
      totalFiles: state.manifest.length,
    };
    publish();
    try {
      let reportedBytes = 0;
      let reportedFiles = 0;
      let existing: Awaited<ReturnType<Client["listFiles"]>> = [];
      try {
        existing = await client.listFiles(state.baseImage);
      } catch (error) {
        if (!(error instanceof SandboxWorkspaceMissingError)) throw error;
      }
      if (existing.length)
        throw new Error(
          "Choose a Sandbox image with an empty /workspace directory",
        );
      const head = await this.workspaceFactory(client).prepare(
        Object.entries(source.files).map(([path, content]) => ({
          path,
          content,
        })),
        state.baseImage,
        "pearl",
        state.baseDigest,
        (operation) => {
          this.recordOperation(state, operation);
          publish();
        },
        (progress) => {
          state.uploadProgress = progress;
          if (
            progress.phase === "verifying" ||
            progress.uploadedBytes - reportedBytes >= 4 * 1024 * 1024 ||
            progress.completedFiles - reportedFiles >= 25 ||
            progress.completedFiles === progress.totalFiles
          ) {
            reportedBytes = progress.uploadedBytes;
            reportedFiles = progress.completedFiles;
            publish();
          }
        },
      );
      if (!head) throw new Error("Sandbox upload returned no saved checkpoint");
      const first: PearlSandboxBranch = {
        id: randomUUID(),
        name: "Main",
        headImage: head,
        files: Object.fromEntries(
          state.manifest.map((file) => [file.path, file.sha256]),
        ),
        checks: [],
      };
      state.branches = [first];
      state.activeBranchId = first.id;
      state.status = "ready";
      state.uploadProgress = undefined;
      state.active = true;
      state.pendingSync = undefined;
      publish();
      return chat;
    } catch (error) {
      const remoteOperation =
        state.lastOperation as PearlSandboxState["lastOperation"];
      state.status =
        remoteOperation?.status === "failed" &&
        !(error instanceof SandboxRequestError)
          ? "prepared"
          : remoteOperation?.remoteId || error instanceof SandboxRequestError
            ? "uncertain"
            : "prepared";
      state.uploadProgress = undefined;
      publish();
      throw error;
    }
  }
  fork(chat: PearlChat, name: unknown): PearlChat {
    const state = chat.sandbox;
    if (!state) throw new Error("No Sandbox is prepared");
    if (state.projectPath !== binding(chat).path)
      throw new Error("This Sandbox belongs to a different project");
    if (typeof name !== "string" || !name.trim() || name.length > 60)
      throw new Error("Enter a branch name of at most 60 characters");
    let parent = branch(state);
    if (parent.syncedHead === parent.headImage) {
      this.switchBranch(chat, parent.id);
      parent = branch(state);
    }
    if (state.branches.length >= 8)
      throw new Error("This task has reached eight branches");
    const child: PearlSandboxBranch = {
      id: randomUUID(),
      name: name.trim(),
      parentId: parent.id,
      headImage: parent.headImage,
      files: { ...parent.files },
      checks: [],
    };
    state.branches.push(child);
    state.activeBranchId = child.id;
    state.pendingSync = undefined;
    chat.readRevisions = {};
    return chat;
  }
  switchBranch(chat: PearlChat, branchId: unknown): PearlChat {
    const state = chat.sandbox;
    const selected = state?.branches.find((item) => item.id === branchId);
    if (
      !state ||
      state.status !== "ready" ||
      typeof branchId !== "string" ||
      !selected
    )
      throw new Error("Unknown Sandbox branch");
    if (state.projectPath !== binding(chat).path)
      throw new Error("This Sandbox belongs to a different project");
    if (selected.syncedHead === selected.headImage) {
      const project = binding(chat);
      const files: Record<string, string> = {};
      for (const [path, digest] of Object.entries(selected.files)) {
        const content = inspectProjectFile(project, path);
        if (content === null || hash(content) !== digest)
          throw new Error(
            "Local project differs from the synchronized checkpoint. Review local changes before resuming this branch.",
          );
        files[path] = content;
      }
      this.saveBaseline(chat, { projectPath: project.path, files });
      state.baseDigest = hash(JSON.stringify(files));
      state.manifest = Object.entries(files).map(([path, content]) => ({
        path,
        bytes: Buffer.byteLength(content),
        sha256: hash(content),
      }));
      selected.checks = [];
      selected.syncedHead = undefined;
      state.activeBranchId = selected.id;
    } else state.activeBranchId = branchId;
    state.active = true;
    state.pendingSync = undefined;
    chat.readRevisions = {};
    return chat;
  }
  leave(chat: PearlChat): PearlChat {
    if (!chat.sandbox || chat.sandbox.status !== "ready")
      throw new Error("No active Sandbox");
    chat.sandbox.active = false;
    chat.readRevisions = {};
    return chat;
  }
  private active(chat: PearlChat): {
    state: PearlSandboxState;
    selected: PearlSandboxBranch;
    client: Client;
  } {
    const state = chat.sandbox;
    if (!state || !state.active || state.projectPath !== binding(chat).path)
      throw new Error("Select an active Sandbox branch for this project");
    return {
      state,
      selected: branch(state),
      client: this.client(state.projectId),
    };
  }
  private selectedForReview(chat: PearlChat): {
    state: PearlSandboxState;
    selected: PearlSandboxBranch;
    client: Client;
  } {
    const state = chat.sandbox;
    if (!state || state.projectPath !== binding(chat).path)
      throw new Error("Sandbox project changed");
    return {
      state,
      selected: branch(state),
      client: this.client(state.projectId),
    };
  }
  async list(
    chat: PearlChat,
    path: unknown,
    offset: unknown = 0,
  ): Promise<{
    entries: { name: string; type: string }[];
    nextOffset: number | null;
  }> {
    const { selected } = this.active(chat);
    if (path !== "" && path !== ".") safeSourcePath(path);
    if (!Number.isSafeInteger(offset) || (offset as number) < 0)
      throw new Error("Invalid directory offset");
    const prefix = path === "" || path === "." ? "" : `${path}/`;
    const entries = new Map<string, "directory" | "file">();
    for (const file of Object.keys(selected.files)) {
      if (!file.startsWith(prefix)) continue;
      const relative = file.slice(prefix.length);
      const [name, ...rest] = relative.split("/");
      if (!name) continue;
      entries.set(name, rest.length ? "directory" : "file");
    }
    const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
    return {
      entries: sorted
        .slice(offset as number, (offset as number) + 500)
        .map(([name, type]) => ({ name, type })),
      nextOffset:
        (offset as number) + 500 < sorted.length
          ? (offset as number) + 500
          : null,
    };
  }
  async read(
    chat: PearlChat,
    path: unknown,
  ): Promise<{ path: string; content: string; sha256: string }> {
    safeSourcePath(path);
    const { selected, client } = this.active(chat);
    if (!selected.files[path])
      throw new Error("File is outside the approved Sandbox source scope");
    const content = await client.downloadFile(selected.headImage, path);
    const sha256 = hash(content);
    if (sha256 !== selected.files[path])
      throw new Error("Sandbox file differs from the saved branch revision");
    chat.readRevisions ||= {};
    chat.readRevisions[path] = sha256;
    return { path, content, sha256 };
  }
  async search(
    chat: PearlChat,
    path: unknown,
    query: unknown,
  ): Promise<{
    matches: { path: string; line: number; text: string }[];
    truncated: boolean;
  }> {
    if (path !== "" && path !== ".") safeSourcePath(path);
    if (typeof query !== "string" || !query || query.length > 200)
      throw new Error("Invalid search query");
    const { selected, client } = this.active(chat);
    const baseline = this.baseline(chat).files;
    const files = Object.keys(selected.files).filter(
      (item) =>
        path === "" ||
        path === "." ||
        item === path ||
        item.startsWith(`${path}/`),
    );
    const matches: { path: string; line: number; text: string }[] = [];
    let inspected = 0;
    let bytes = 0;
    for (const file of files) {
      if (inspected >= maxFiles || bytes >= maxBytes || matches.length >= 50)
        break;
      const source = baseline[file];
      const content =
        source !== undefined && hash(source) === selected.files[file]
          ? source
          : await client.downloadFile(selected.headImage, file);
      if (hash(content) !== selected.files[file])
        throw new Error("Sandbox file differs from the saved branch revision");
      inspected++;
      bytes += Buffer.byteLength(content);
      content.split("\n").forEach((line, index) => {
        if (matches.length < 50 && line.includes(query))
          matches.push({
            path: file,
            line: index + 1,
            text: line.slice(0, 300),
          });
      });
    }
    return {
      matches,
      truncated:
        inspected < files.length || bytes >= maxBytes || matches.length >= 50,
    };
  }
  async write(
    chat: PearlChat,
    path: unknown,
    content: unknown,
    expectedSha256: unknown,
    publish: () => void,
  ): Promise<{ path: string; sha256: string; written: boolean }> {
    safeSourcePath(path);
    if (
      typeof content !== "string" ||
      Buffer.byteLength(content) > maxFileBytes ||
      content.includes("\0") ||
      containsSecret(content)
    )
      throw new Error("Unsafe or oversized Sandbox file content");
    const { state, selected, client } = this.active(chat);
    const before = selected.files[path];
    if (before) {
      if (
        typeof expectedSha256 !== "string" ||
        expectedSha256 !== before ||
        chat.readRevisions?.[path] !== before
      )
        throw new Error("Read the current Sandbox file before editing it");
    } else if (expectedSha256 !== undefined) {
      throw new Error("Create a new file without an expected revision");
    }
    const original = this.baseline(chat).files;
    const changed = Object.keys(selected.files).filter(
      (item) =>
        original[item] === undefined ||
        hash(original[item]) !== selected.files[item],
    );
    if (!changed.includes(path) && changed.length >= maxChangedFiles)
      throw new Error("A Sandbox branch can change at most 100 source files");
    const nextHash = hash(content);
    if (before === nextHash) throw new Error("File content is unchanged");
    state.lastOperation = undefined;
    state.pendingWrite = {
      path,
      sha256: nextHash,
      baseHead: selected.headImage,
    };
    publish();
    try {
      const head = await this.workspaceFactory(client).write(
        selected.headImage,
        path,
        content,
        "pearl",
        selected.headImage,
        (operation) => {
          this.recordOperation(state, operation, path);
          publish();
        },
      );
      if (!head) throw new Error("Sandbox write returned no saved checkpoint");
      selected.headImage = head;
      selected.files[path] = nextHash;
      state.pendingWrite = undefined;
      state.pendingSync = undefined;
      chat.readRevisions ||= {};
      chat.readRevisions[path] = nextHash;
      publish();
      return { path, sha256: nextHash, written: true };
    } catch (error) {
      const remoteOperation =
        state.lastOperation as PearlSandboxState["lastOperation"];
      if (remoteOperation?.remoteId || error instanceof SandboxRequestError)
        state.status = "uncertain";
      else state.pendingWrite = undefined;
      publish();
      throw error;
    }
  }
  async reconcile(chat: PearlChat): Promise<PearlChat> {
    const state = chat.sandbox;
    if (
      !state ||
      state.status !== "uncertain" ||
      !state.lastOperation?.remoteId
    )
      throw new Error(
        "No recoverable Sandbox operation ID is available. Inspect Nebius operation history before retrying.",
      );
    const client = this.client(state.projectId);
    const result = await client.status(state.lastOperation.remoteId);
    if (!result.terminal)
      throw new Error(
        "The Sandbox operation is still running. Check again later.",
      );
    if (!result.commandPassed || !result.resultImage)
      throw new Error(
        "The remote operation did not save a usable checkpoint. Inspect Nebius before retrying.",
      );
    const head = result.resultImage;
    if (state.lastOperation.stage === "bootstrap") {
      await client.inspectImage(head);
      const existing = await client.listFiles(head);
      if (existing.length)
        throw new Error("Recovered Sandbox workspace is not empty");
      state.baseImage = head;
      state.lastOperation = undefined;
      state.status = "prepared";
      state.active = false;
      return chat;
    }
    if (state.pendingWrite) {
      const pending = state.pendingWrite;
      const selected = state.branches.find(
        (item) => item.id === state.activeBranchId,
      );
      if (!selected || selected.headImage !== pending.baseHead)
        throw new Error("Sandbox branch moved during recovery");
      const content = await client.downloadFile(head, pending.path);
      if (hash(content) !== pending.sha256)
        throw new Error("Saved Sandbox write differs from the proposed file");
      selected.headImage = head;
      selected.files[pending.path] = pending.sha256;
      state.pendingWrite = undefined;
    } else if (state.pendingInstall) {
      const pending = state.pendingInstall;
      const selected = state.branches.find(
        (item) => item.id === pending.branchId,
      );
      if (!selected || selected.headImage !== pending.baseHead)
        throw new Error("Sandbox branch moved during installation recovery");
      selected.files = await this.installedSourceFiles(
        client,
        head,
        selected.files,
      );
      selected.headImage = head;
      state.pendingInstall = undefined;
    } else {
      if (state.branches.length)
        throw new Error(
          "An unrecognized Sandbox operation needs manual inspection",
        );
      for (const file of state.manifest) {
        const content = await client.downloadFile(head, file.path);
        if (hash(content) !== file.sha256)
          throw new Error(
            "Recovered upload does not contain the complete reviewed snapshot",
          );
      }
      const first: PearlSandboxBranch = {
        id: randomUUID(),
        name: "Main",
        headImage: head,
        files: Object.fromEntries(
          state.manifest.map((file) => [file.path, file.sha256]),
        ),
        checks: [],
      };
      state.branches = [first];
      state.activeBranchId = first.id;
    }
    state.status = "ready";
    state.active = true;
    state.pendingSync = undefined;
    chat.readRevisions = {};
    return chat;
  }
  async check(
    chat: PearlChat,
    command: unknown,
    args: unknown,
    expectedHead: unknown,
    publish: () => void,
  ) {
    const { state, selected, client } = this.active(chat);
    if (expectedHead !== selected.headImage)
      throw new Error("Sandbox branch changed since command approval");
    if (
      typeof command !== "string" ||
      !/^[A-Za-z0-9_.+-]{1,80}$/.test(command) ||
      !Array.isArray(args) ||
      args.length > 32 ||
      args.some((arg) => typeof arg !== "string" || arg.length > 2000)
    )
      throw new Error("Invalid Sandbox check command");
    const result = await this.workspaceFactory(client).check(
      selected.headImage,
      [],
      command,
      args,
      "pearl",
      selected.headImage,
      (operation) => {
        this.recordOperation(state, operation);
        publish();
      },
    );
    selected.checks.push({
      command,
      args,
      exitCode: result.exitCode,
      passed: result.passed,
      at: new Date().toISOString(),
      stdout: result.stdout.slice(0, 10_000),
      stderr: result.stderr.slice(0, 10_000),
    });
    publish();
    return {
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      passed: result.passed,
      writesPersisted: false,
    };
  }
  async install(
    chat: PearlChat,
    command: unknown,
    args: unknown,
    expectedHead: unknown,
    publish: () => void,
  ) {
    const { state, selected, client } = this.active(chat);
    if (expectedHead !== selected.headImage)
      throw new Error("Sandbox branch changed since installation approval");
    if (
      typeof command !== "string" ||
      !/^[A-Za-z0-9_.+-]{1,80}$/.test(command) ||
      !Array.isArray(args) ||
      args.length > 32 ||
      args.some(
        (arg) =>
          typeof arg !== "string" ||
          arg.length > 2000 ||
          /[\x00-\x1f\x7f]/.test(arg),
      )
    )
      throw new Error("Invalid dependency installation command");
    const workspace = this.workspaceFactory(client);
    if (!workspace.install)
      throw new Error("Sandbox dependency installation is unavailable");
    state.pendingInstall = {
      baseHead: selected.headImage,
      branchId: selected.id,
    };
    state.lastOperation = undefined;
    try {
      const result = await workspace.install(
        selected.headImage,
        command,
        args,
        "pearl",
        selected.headImage,
        (operation) => {
          this.recordOperation(state, operation);
          publish();
        },
      );
      if (!result.outcome.passed) {
        state.pendingInstall = undefined;
        publish();
        return {
          command,
          exitCode: result.outcome.exitCode,
          stdout: result.outcome.stdout,
          stderr: result.outcome.stderr,
          passed: false,
          writesPersisted: false,
        };
      }
      if (selected.headImage !== expectedHead)
        throw new Error(
          "Sandbox branch changed during dependency installation",
        );
      const files = await this.installedSourceFiles(
        client,
        result.imageId,
        selected.files,
      );
      selected.headImage = result.imageId;
      selected.files = files;
      state.pendingInstall = undefined;
      state.pendingSync = undefined;
      chat.readRevisions = {};
      publish();
      return {
        command,
        exitCode: result.outcome.exitCode,
        stdout: result.outcome.stdout,
        stderr: result.outcome.stderr,
        passed: result.outcome.passed,
        writesPersisted: true,
        checkpoint: result.imageId,
      };
    } catch (error) {
      const lastOperation =
        state.lastOperation as PearlSandboxState["lastOperation"];
      if (
        (lastOperation?.remoteId && lastOperation.status !== "failed") ||
        error instanceof SandboxRequestError
      )
        state.status = "uncertain";
      else state.pendingInstall = undefined;
      publish();
      throw error;
    }
  }
  private async installedSourceFiles(
    client: Client,
    imageId: string,
    previous: Record<string, string>,
  ): Promise<Record<string, string>> {
    const paths: string[] = [];
    const queue = [""];
    const generated = new Set([
      "node_modules",
      ".venv",
      "venv",
      ".gradle",
      ".m2",
      "target",
      "build",
      "dist",
      "vendor",
      "__pycache__",
    ]);
    const tracked = Object.keys(previous);
    while (queue.length) {
      if (queue.length + paths.length > maxFiles)
        throw new Error(
          "Installed Sandbox workspace exceeds the source listing limit",
        );
      const dir = queue.shift()!;
      const entries = await client.listFiles(
        imageId,
        dir ? `/workspace/${dir}` : "/workspace",
      );
      for (const entry of entries) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (blockedProjectPart(entry.name)) continue;
        if (
          (generated.has(entry.name) || entry.name.startsWith(".scully-")) &&
          !tracked.some((item) => item === path || item.startsWith(`${path}/`))
        )
          continue;
        safeSourcePath(path);
        if (entry.symlink) continue;
        if (entry.directory) queue.push(path);
        else if (entry.regular && entry.size <= maxFileBytes) paths.push(path);
      }
    }
    if (paths.length > maxFiles)
      throw new Error(
        "Installed Sandbox workspace exceeds the source file limit",
      );
    const files: Record<string, string> = {};
    let bytes = 0;
    for (const path of paths) {
      const content = await client.downloadFile(imageId, path);
      if (
        content.includes("\0") ||
        content.includes("\uFFFD") ||
        containsSecret(content)
      ) {
        if (previous[path])
          throw new Error(
            `Installed Sandbox source cannot be safely inspected: ${path}`,
          );
        continue;
      }
      bytes += Buffer.byteLength(content);
      if (bytes > maxBytes)
        throw new Error(
          "Installed Sandbox source exceeds the 256 MB review limit",
        );
      files[path] = hash(content);
    }
    return files;
  }
  private changed(chat: PearlChat): {
    selected: PearlSandboxBranch;
    files: TaskFileChange[];
    baseline: Baseline;
  } {
    const { selected } = this.selectedForReview(chat);
    const original = this.baseline(chat);
    const paths = Object.keys(selected.files)
      .filter(
        (path) =>
          selected.files[path] !==
          (original.files[path] === undefined
            ? undefined
            : hash(original.files[path])),
      )
      .sort();
    return {
      selected,
      baseline: original,
      files: paths.map((path) => ({
        path,
        kind: original.files[path] === undefined ? "added" : "modified",
        beforeBytes: Buffer.byteLength(original.files[path] || ""),
        afterBytes: 0,
      })),
    };
  }
  async fileReview(chat: PearlChat, path: unknown): Promise<FileReview> {
    safeSourcePath(path);
    const { selected, files, baseline } = this.changed(chat);
    if (!files.some((file) => file.path === path))
      throw new Error("File has no changes in this branch");
    const after = await this.selectedForReview(chat).client.downloadFile(
      selected.headImage,
      path,
    );
    if (hash(after) !== selected.files[path])
      throw new Error("Sandbox file differs from the saved branch revision");
    if (
      chat.sandbox?.pendingSync?.headImage === selected.headImage &&
      !chat.sandbox.pendingSync.viewed.includes(path)
    )
      chat.sandbox.pendingSync.viewed.push(path);
    return { path, before: baseline.files[path] ?? null, after, binary: false };
  }
  beginTurn(chat: PearlChat, turnId: string): void {
    const { state, selected } = this.active(chat);
    if (state.pendingTurn?.turnId === turnId) return;
    state.pendingTurn = {
      turnId,
      branchId: selected.id,
      headImage: selected.headImage,
      files: { ...selected.files },
    };
  }
  finishTurn(chat: PearlChat, turnId: string): TaskChangeSet | null {
    const state = chat.sandbox;
    const pending = state?.pendingTurn;
    if (!state || !pending || pending.turnId !== turnId) return null;
    state.pendingTurn = undefined;
    const selected = state.branches.find(
      (item) => item.id === pending.branchId,
    );
    if (!selected || state.status !== "ready")
      return {
        turnId,
        at: new Date().toISOString(),
        files: [],
        source: "sandbox",
        undoAvailable: false,
        reason:
          "The Sandbox branch changed before this turn could be reviewed.",
      };
    const paths = new Set([
      ...Object.keys(pending.files),
      ...Object.keys(selected.files),
    ]);
    const changed = [...paths]
      .filter((path) => pending.files[path] !== selected.files[path])
      .sort();
    if (!changed.length && pending.headImage === selected.headImage)
      return null;
    const beforeFiles: Record<string, string | null> = {};
    const afterFiles: Record<string, string> = {};
    const files: TaskFileChange[] = changed.map((path) => {
      beforeFiles[path] = pending.files[path] ?? null;
      if (selected.files[path]) afterFiles[path] = selected.files[path];
      return {
        path,
        kind: !pending.files[path]
          ? "added"
          : !selected.files[path]
            ? "deleted"
            : "modified",
        beforeBytes: 0,
        afterBytes: 0,
      };
    });
    return {
      turnId,
      at: new Date().toISOString(),
      files,
      source: "sandbox",
      undoAvailable: state.activeBranchId === selected.id,
      reason:
        state.activeBranchId === selected.id
          ? undefined
          : "Select the branch used by this turn before undoing it.",
      sandboxRevision: {
        branchId: selected.id,
        beforeHead: pending.headImage,
        afterHead: selected.headImage,
        beforeFiles,
        afterFiles,
      },
    };
  }
  async taskFileReview(
    chat: PearlChat,
    task: TaskChangeSet,
    path: unknown,
  ): Promise<FileReview> {
    safeSourcePath(path);
    const revision = task.sandboxRevision;
    if (
      task.source !== "sandbox" ||
      !revision ||
      !task.files.some((file) => file.path === path)
    )
      throw new Error("File is outside this Sandbox turn");
    const { state, client } = this.selectedForReview(chat);
    if (!state.branches.some((item) => item.id === revision.branchId))
      throw new Error("Sandbox branch is unavailable");
    const before = revision.beforeFiles[path]
      ? await client.downloadFile(revision.beforeHead, path)
      : null;
    const after = revision.afterFiles[path]
      ? await client.downloadFile(revision.afterHead, path)
      : null;
    if (
      (before !== null && hash(before) !== revision.beforeFiles[path]) ||
      (after !== null && hash(after) !== revision.afterFiles[path])
    )
      throw new Error("Sandbox file differs from the reviewed turn");
    return { path, before, after, binary: false };
  }
  undoTurn(chat: PearlChat, task: TaskChangeSet): TaskChangeSet {
    const revision = task.sandboxRevision;
    if (task.source !== "sandbox" || !revision || !task.undoAvailable)
      throw new Error("Sandbox Undo is unavailable");
    const { state } = this.selectedForReview(chat);
    const selected = state.branches.find(
      (item) => item.id === revision.branchId,
    );
    if (!selected || selected.headImage !== revision.afterHead)
      throw new Error(
        "Sandbox branch changed since this turn. Review the latest checkpoint.",
      );
    if (selected.syncedHead === revision.afterHead)
      throw new Error(
        "This checkpoint was synchronized locally. Review local changes before undoing it.",
      );
    for (const [path, digest] of Object.entries(revision.afterFiles))
      if (selected.files[path] !== digest)
        throw new Error(
          "Sandbox branch changed since this turn. Review the latest checkpoint.",
        );
    selected.headImage = revision.beforeHead;
    for (const [path, digest] of Object.entries(revision.beforeFiles)) {
      if (digest === null) delete selected.files[path];
      else selected.files[path] = digest;
      delete chat.readRevisions?.[path];
    }
    selected.checks = [];
    state.pendingSync = undefined;
    return { ...task, undone: true, undoAvailable: false };
  }
  snapshotView(chat: PearlChat): PearlSandboxSnapshot {
    if (!chat.project?.approved)
      throw new Error("Approve the project folder first");
    if (!chat.sandbox || chat.sandbox.projectPath !== chat.project.path)
      return {
        branch: "",
        checkpoint: "",
        files: [],
        operations: [],
        checks: [],
      };
    const { state, selected } = this.selectedForReview(chat);
    const baseline = this.baseline(chat);
    return {
      branch: selected.name,
      checkpoint: selected.headImage,
      files: Object.entries(selected.files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, sha256]) => ({
          path,
          sha256,
          changed:
            baseline.files[path] === undefined ||
            hash(baseline.files[path]) !== sha256,
        })),
      operations: state.operations || [],
      checks: selected.checks,
    };
  }
  async inspectFile(chat: PearlChat, path: unknown): Promise<FileReview> {
    safeSourcePath(path);
    const { selected, client } = this.selectedForReview(chat);
    if (!selected.files[path])
      throw new Error("File is outside the approved Sandbox source scope");
    const after = await client.downloadFile(selected.headImage, path);
    if (hash(after) !== selected.files[path])
      throw new Error("Sandbox file differs from the saved branch revision");
    return {
      path,
      before: this.baseline(chat).files[path] ?? null,
      after,
      binary: false,
    };
  }
  async reviewSync(chat: PearlChat): Promise<PearlChat> {
    const state = chat.sandbox!;
    const { selected, files } = this.changed(chat);
    if (selected.syncedHead === selected.headImage)
      throw new Error("This Sandbox checkpoint is already synchronized");
    if (!files.length)
      throw new Error("This branch has no source changes to synchronize");
    for (const file of files) {
      const review = await this.fileReview(chat, file.path);
      file.afterBytes = Buffer.byteLength(review.after || "");
    }
    state.pendingSync = {
      token: randomUUID(),
      branchId: selected.id,
      headImage: selected.headImage,
      files,
      viewed: [],
    };
    return chat;
  }
  async approveSync(
    chat: PearlChat,
    token: unknown,
    publish: () => void = () => {},
  ): Promise<PearlChat> {
    const state = chat.sandbox;
    const review = state?.pendingSync;
    if (
      !state ||
      !review ||
      typeof token !== "string" ||
      review.token !== token
    )
      throw new Error("Sync review is missing or already used");
    if (review.files.some((file) => !review.viewed.includes(file.path)))
      throw new Error("Open each changed file before approving local sync");
    const { selected, baseline } = this.changed(chat);
    if (
      selected.id !== review.branchId ||
      selected.headImage !== review.headImage
    )
      throw new Error("Sandbox branch changed since sync review");
    state.pendingSync = undefined;
    publish();
    const project = binding(chat);
    const drafts: DraftFile[] = [];
    for (const file of review.files) {
      const before = baseline.files[file.path] ?? null;
      const current = inspectProjectFile(project, file.path);
      if (current !== before)
        throw new Error(
          `Local file changed since the Sandbox snapshot: ${file.path}. Nothing was synchronized.`,
        );
      const after = await this.selectedForReview(chat).client.downloadFile(
        selected.headImage,
        file.path,
      );
      if (hash(after) !== selected.files[file.path])
        throw new Error("Sandbox branch changed during sync review");
      drafts.push({ path: file.path, before, content: after });
    }
    if (drafts.length === 1)
      writeProjectWorkspace(
        project,
        drafts,
        () => {},
        join(this.dataRoot, "pearl-backups", chat.id, randomUUID()),
      );
    else
      writeProjectTransaction(
        project,
        drafts,
        join(this.dataRoot, "pearl-transactions", chat.id),
        join(this.dataRoot, "pearl-backups", chat.id, randomUUID()),
      );
    const nextFiles = { ...baseline.files };
    for (const draft of drafts) nextFiles[draft.path] = draft.content;
    this.saveBaseline(chat, { projectPath: project.path, files: nextFiles });
    state.baseDigest = hash(JSON.stringify(nextFiles));
    state.manifest = Object.entries(nextFiles).map(([path, content]) => ({
      path,
      bytes: Buffer.byteLength(content),
      sha256: hash(content),
    }));
    selected.syncedHead = selected.headImage;
    state.activeBranchId = selected.id;
    state.active = false;
    return chat;
  }
}
