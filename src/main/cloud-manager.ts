import { createHash, randomUUID } from "node:crypto";
import { commandRevision } from "../engine/revision";
import { snapshotRevision } from "../engine/integration";
import {
  sandboxBody,
  sandboxClient,
  type SandboxCommand,
} from "../engine/sandbox";
import { findingCheckCurrent } from "../shared/audits";
import type {
  CloudConfig,
  CloudImageCatalog,
  CloudExecution,
  CloudExecutableResolution,
  CloudReview,
  CloudReviewOptions,
  CloudSession,
} from "../shared/cloud";
import { containsSecret, type Run } from "../shared/runs";
import type { MetricSink } from "../shared/telemetry";
import { snapshotFiles } from "./local-workspace";
import { Store } from "./store";

type Ticket = { review: CloudReview; files: Map<string, string> };
function reviewOptions(value: unknown): CloudReviewOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid cloud review options");
  const options = value as CloudReviewOptions;
  if (
    Object.keys(value).some(
      (key) => !["saveChanges", "parentExecutionId"].includes(key),
    ) ||
    (options.saveChanges !== undefined &&
      typeof options.saveChanges !== "boolean") ||
    (options.parentExecutionId !== undefined &&
      (typeof options.parentExecutionId !== "string" ||
        !options.parentExecutionId ||
        options.parentExecutionId.length > 100))
  )
    throw new Error("Invalid cloud review options");
  return {
    saveChanges: options.saveChanges,
    parentExecutionId: options.parentExecutionId,
  };
}
export class CloudManager {
  collaborationConfig() {
    return this.config && { ...this.config };
  }
  private config: CloudConfig | null = null;
  private catalog: Map<string, string> | null = null;
  private catalogVersion = 0;
  private ticket: Ticket | null = null;
  private inspectedCheckpoint: {
    runId: string;
    executionId: string;
    image: string;
    catalogVersion: number;
  } | null = null;
  private verifiedExecutable: {
    runId: string;
    commandId: string;
    image: string;
    path: string;
    catalogVersion: number;
  } | null = null;
  private busy = false;
  constructor(
    private store: Store,
    private publish: (run: Run) => void,
    private sink: MetricSink,
    private clientFactory: typeof sandboxClient = sandboxClient,
  ) {}
  session(): CloudSession {
    return {
      configured: !!this.config,
      projectId: this.config?.projectId || "",
    };
  }
  configure(value: unknown): CloudSession {
    if (this.busy) throw new Error("Cloud runner is busy");
    const v = value as CloudConfig;
    if (!v || typeof v.key !== "string" || typeof v.projectId !== "string")
      throw new Error("Enter a sandbox API key and project ID");
    this.clientFactory(v, fetch, this.sink);
    this.config = { key: v.key, projectId: v.projectId };
    this.catalog = null;
    this.catalogVersion++;
    this.ticket = null;
    this.verifiedExecutable = null;
    this.inspectedCheckpoint = null;
    return this.session();
  }
  async images(tagPrefix: unknown): Promise<CloudImageCatalog> {
    if (this.busy || !this.config)
      throw new Error("Cloud runner is busy or not configured");
    const config = this.config;
    const version = ++this.catalogVersion;
    this.catalog = null;
    this.ticket = null;
    this.verifiedExecutable = null;
    this.inspectedCheckpoint = null;
    const result = await this.clientFactory(config, fetch, this.sink).images(
      tagPrefix as string,
    );
    if (version !== this.catalogVersion || this.config !== config)
      throw new Error("Image search changed. Search again.");
    this.catalog = new Map(
      result.images.map((image) => [image.uuid, image.tag]),
    );
    return result;
  }
  private command(id: unknown, commandId: unknown) {
    const run = this.store.getRun(id);
    if (run.status !== "complete")
      throw new Error("Complete the run before a cloud check");
    if (
      run.coordination &&
      (run.coordination.auditedRevision !==
        snapshotRevision(run.files, run.drafts) ||
        run.coordination.integratedRevision !==
          run.coordination.auditedRevision)
    )
      throw new Error("Combined draft has no current revision-bound audit");
    const command = run.commands?.find((item) => item.id === commandId);
    if (
      !command ||
      command.decision === "denied" ||
      command.revision !== commandRevision(run)
    )
      throw new Error("Command proposal is missing, denied or stale");
    if (command.findingLink && !findingCheckCurrent(run, command))
      throw new Error("Finding or audit changed. This check is stale.");
    return { run, command };
  }
  private checkpoint(
    run: Run,
    image: unknown,
    executionId: unknown,
  ): CloudExecution {
    const parent = run.cloudExecutions?.find((item) => item.id === executionId);
    if (
      typeof executionId !== "string" ||
      !parent ||
      parent.saveChanges !== true ||
      !parent.resultImage ||
      parent.resultImage !== image ||
      parent.status !== "complete" ||
      parent.remoteStatus !== "SUCCESS" ||
      parent.projectId !== this.config?.projectId ||
      parent.revision !== commandRevision(run)
    )
      throw new Error(
        "Saved environment is missing, stale or belongs to another project",
      );
    return parent;
  }
  private imageSource(run: Run, image: unknown, parentExecutionId?: unknown) {
    if (typeof image !== "string")
      throw new Error("Choose an image from the current catalog");
    if (parentExecutionId !== undefined) {
      const parent = this.checkpoint(run, image, parentExecutionId);
      return {
        image,
        imageTag: `Saved environment from ${parent.executable}`,
        parentExecutionId: parent.id,
      };
    }
    const imageTag = this.catalog?.get(image);
    if (!imageTag) throw new Error("Choose an image from the current catalog");
    return { image, imageTag, parentExecutionId: undefined };
  }
  async resolveExecutable(
    id: unknown,
    commandId: unknown,
    image: unknown,
    parentExecutionId?: unknown,
  ): Promise<CloudExecutableResolution> {
    if (this.busy || !this.config)
      throw new Error("Cloud runner is busy or not configured");
    this.ticket = null;
    this.verifiedExecutable = null;
    this.inspectedCheckpoint = null;
    const { run, command } = this.command(id, commandId);
    const source = this.imageSource(run, image, parentExecutionId);
    const config = this.config;
    const catalogVersion = this.catalogVersion;
    const client = this.clientFactory(config, fetch, this.sink);
    if (source.parentExecutionId) {
      await client.inspectImage(source.image);
      if (this.config !== config || this.catalogVersion !== catalogVersion)
        throw new Error("Image search or credentials changed. Search again.");
      this.checkpoint(
        this.command(run.id, command.id).run,
        source.image,
        source.parentExecutionId,
      );
      this.inspectedCheckpoint = {
        runId: run.id,
        executionId: source.parentExecutionId,
        image: source.image,
        catalogVersion,
      };
    }
    let path: string | null;
    try {
      path = await client.inspectExecutable(source.image, command.executable);
    } catch {
      if (this.config !== config || this.catalogVersion !== catalogVersion)
        throw new Error("Image search or credentials changed. Search again.");
      this.command(run.id, command.id);
      return {
        path: null,
        reason:
          "Image inspection was unavailable. Enter an absolute path to review it manually. Scully cannot verify a manually entered path.",
      };
    }
    if (this.config !== config || this.catalogVersion !== catalogVersion)
      throw new Error("Image search or credentials changed. Search again.");
    this.command(run.id, command.id);
    if (!path)
      return {
        path: null,
        reason: `No executable named ${command.executable} was verified in the standard image paths. Enter an absolute path to review it manually.`,
      };
    this.verifiedExecutable = {
      runId: run.id,
      commandId: command.id,
      image: source.image,
      path,
      catalogVersion,
    };
    return {
      path,
      reason:
        "Executable file and permission verified in the selected image. Runtime dependencies are not checked.",
    };
  }
  review(
    id: unknown,
    commandId: unknown,
    image: unknown,
    executable: unknown,
    value?: unknown,
  ): CloudReview {
    if (this.busy || !this.config)
      throw new Error("Cloud runner is busy or not configured");
    this.ticket = null;
    const options = reviewOptions(value);
    const { run, command } = this.command(id, commandId);
    if ((run.cloudExecutions?.length || 0) >= 5)
      throw new Error("This run reached its five-cloud-check limit");
    if (typeof image !== "string" || typeof executable !== "string")
      throw new Error("Enter an image UUID and absolute guest executable");
    const source = this.imageSource(run, image, options.parentExecutionId);
    if (
      source.parentExecutionId &&
      (this.inspectedCheckpoint?.runId !== run.id ||
        this.inspectedCheckpoint.executionId !== source.parentExecutionId ||
        this.inspectedCheckpoint.image !== image ||
        this.inspectedCheckpoint.catalogVersion !== this.catalogVersion)
    )
      throw new Error(
        "Inspect the saved environment before reviewing this branch",
      );
    const files = snapshotFiles(run);
    if (files.size > 12)
      throw new Error(
        "Cloud checks currently support at most 12 reviewed files",
      );
    const cwd =
      command.cwd === "." ? "/workspace" : `/workspace/${command.cwd}`;
    const spec: SandboxCommand = {
      image,
      command: executable,
      args: [...command.args],
      cwd,
      timeoutSeconds: command.timeoutSeconds,
      saveChanges: options.saveChanges === true,
    };
    sandboxBody({
      ...spec,
      files: Object.fromEntries(
        [...files.keys()].map((path) => [
          `/workspace/${path}`,
          {
            uuid: "00000000-0000-4000-8000-000000000000",
            uid: 0,
            gid: 0,
            mode: "0600",
          },
        ]),
      ),
    });
    const review: CloudReview = {
      token: randomUUID(),
      runId: run.id,
      commandId: command.id,
      revision: command.revision,
      image,
      imageTag: source.imageTag,
      saveChanges: options.saveChanges === true,
      parentExecutionId: source.parentExecutionId,
      executableVerified:
        this.verifiedExecutable?.runId === run.id &&
        this.verifiedExecutable.commandId === command.id &&
        this.verifiedExecutable.image === image &&
        this.verifiedExecutable.path === executable &&
        this.verifiedExecutable.catalogVersion === this.catalogVersion,
      executable,
      args: [...command.args],
      cwd,
      timeoutSeconds: command.timeoutSeconds,
      files: [...files].map(([path, content]) => {
        if (containsSecret(content))
          throw new Error("Snapshot appears to contain a credential");
        const bytes = Buffer.from(content, "utf8");
        return {
          path,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
      projectId: this.config.projectId,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    this.ticket = { review, files };
    return review;
  }
  private save(runId: string, result: CloudExecution) {
    this.publish(this.store.updateCloudExecution(runId, result));
  }
  async submit(token: unknown, approved: unknown): Promise<Run> {
    if (this.busy) throw new Error("Cloud runner is busy");
    const ticket = this.ticket;
    if (!ticket || ticket.review.token !== token)
      throw new Error("Prepare a fresh cloud review");
    this.ticket = null;
    if (approved !== true)
      throw new Error("Fresh explicit cloud approval required");
    this.busy = true;
    const r = ticket.review;
    try {
      if (
        !this.config ||
        this.config.projectId !== r.projectId ||
        Date.now() >= Date.parse(r.expiresAt)
      )
        throw new Error("Cloud review expired or credentials changed");
      const { run, command } = this.command(r.runId, r.commandId);
      if (r.parentExecutionId)
        this.checkpoint(run, r.image, r.parentExecutionId);
      const current = snapshotFiles(run);
      if (
        command.revision !== r.revision ||
        current.size !== ticket.files.size ||
        [...current].some(
          ([path, content]) => content !== ticket.files.get(path),
        )
      )
        throw new Error("Snapshot changed. Review again.");
      if ((run.cloudExecutions?.length || 0) >= 5)
        throw new Error("Cloud-check limit reached");
      const client = this.clientFactory(this.config, fetch, this.sink);
      const { token: _token, expiresAt: _expiresAt, ...details } = r;
      const result: CloudExecution = {
        ...details,
        id: randomUUID(),
        status: "uploading",
        operationId: null,
        remoteStatus: null,
        resultImage: null,
        startedAt: new Date().toISOString(),
        commandPassed: null,
        exitCode: null,
        stdout: "",
        stderr: "",
        error: "",
      };
      this.save(r.runId, result);
      const uploaded: NonNullable<SandboxCommand["files"]> =
        Object.create(null);
      try {
        for (const [path, content] of ticket.files) {
          const file = await client.upload(content);
          uploaded[`/workspace/${path}`] = {
            uuid: file.uuid,
            uid: 0,
            gid: 0,
            mode: "0600",
          };
        }
      } catch (error) {
        result.status = "failed";
        result.error =
          error instanceof Error ? error.message : "File upload failed";
        result.finishedAt = new Date().toISOString();
        this.save(r.runId, result);
        return this.store.getRun(r.runId);
      }
      try {
        const latest = this.command(r.runId, r.commandId);
        if (r.parentExecutionId)
          this.checkpoint(latest.run, r.image, r.parentExecutionId);
        const files = snapshotFiles(latest.run);
        if (
          Date.now() >= Date.parse(r.expiresAt) ||
          latest.command.revision !== r.revision ||
          files.size !== ticket.files.size ||
          [...files].some(
            ([path, content]) => content !== ticket.files.get(path),
          )
        )
          throw new Error(
            "Snapshot or approval expired during upload. No command was submitted.",
          );
      } catch {
        result.status = "failed";
        result.error =
          "Snapshot or approval changed during upload. Files may remain on Nebius, but no command was submitted.";
        result.finishedAt = new Date().toISOString();
        this.save(r.runId, result);
        return this.store.getRun(r.runId);
      }
      result.status = "submission_unknown";
      result.error =
        "Submission may be in progress. No automatic retry is allowed.";
      this.save(r.runId, result);
      try {
        const operationId = await client.submit(
          {
            image: r.image,
            command: r.executable,
            args: r.args,
            cwd: r.cwd,
            timeoutSeconds: r.timeoutSeconds,
            saveChanges: r.saveChanges === true,
            files: uploaded,
          },
          true,
        );
        result.operationId = operationId;
        result.status = "submitted";
        result.error = "";
        this.save(r.runId, result);
      } catch {
        result.error =
          "Submission outcome is unknown. Inspect Nebius operation history before another attempt.";
        this.save(r.runId, result);
      }
      return this.store.getRun(r.runId);
    } finally {
      this.busy = false;
    }
  }
  async refresh(runId: unknown, executionId: unknown): Promise<Run> {
    if (this.busy || !this.config)
      throw new Error("Cloud runner is busy or not configured");
    const run = this.store.getRun(runId);
    const result = run.cloudExecutions?.find((item) => item.id === executionId);
    if (
      !result ||
      !result.operationId ||
      result.projectId !== this.config.projectId
    )
      throw new Error("Cloud operation is unavailable for this project");
    this.busy = true;
    try {
      const status = await this.clientFactory(
        this.config,
        fetch,
        this.sink,
      ).status(result.operationId);
      result.remoteStatus = status.status;
      result.resultImage =
        result.saveChanges === true ? status.resultImage : null;
      result.commandPassed = status.terminal ? status.commandPassed : null;
      result.exitCode = status.exitCode;
      result.timedOut = status.timedOut;
      result.signal = status.signal;
      result.stdout = status.stdout;
      result.stderr = status.stderr;
      result.outputTruncated = status.truncated;
      result.status = status.terminal ? "complete" : "submitted";
      if (status.terminal) result.finishedAt = new Date().toISOString();
      this.save(run.id, result);
      return this.store.getRun(run.id);
    } finally {
      this.busy = false;
    }
  }
}
