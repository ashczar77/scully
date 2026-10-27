import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  sandboxClient,
  SandboxRequestError,
  SandboxWorkspaceMissingError,
  type SandboxStatus,
} from "../engine/sandbox";
import { safePath, type SourceFile } from "../shared/runs";
import type { CollaborationOperation } from "../shared/collaboration";
import { resolveExecutable } from "./local-workspace";

export type CheckOutcome = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  passed: boolean;
  unknown: boolean;
};
export type OperationUpdate = (operation: CollaborationOperation) => void;
export type CollaborationWorkspace = {
  prepare(
    files: SourceFile[],
    imageId: string | null,
    actor: string,
    revision: string,
    update: OperationUpdate,
  ): Promise<string | null>;
  write(
    imageId: string | null,
    path: string,
    content: string,
    actor: string,
    revision: string,
    update: OperationUpdate,
  ): Promise<string | null>;
  read(imageId: string | null, path: string, fallback: string): Promise<string>;
  check(
    imageId: string | null,
    files: SourceFile[],
    command: string,
    args: string[],
    actor: string,
    revision: string,
    update: OperationUpdate,
  ): Promise<CheckOutcome>;
  reconcile(operation: CollaborationOperation): Promise<{
    status: "running" | "complete" | "failed";
    resultImageId: string | null;
  }>;
};
function operation(
  actor: string,
  stage: string,
  revision: string,
): CollaborationOperation {
  return {
    id: randomUUID(),
    actor,
    stage,
    inputRevision: revision,
    status: "pending",
    remoteId: null,
    resultImageId: null,
    at: new Date().toISOString(),
  };
}
function updated(
  value: CollaborationOperation,
  patch: Partial<CollaborationOperation>,
  publish: OperationUpdate,
) {
  Object.assign(value, patch);
  publish({ ...value });
}
export function localCollaborationWorkspace(): CollaborationWorkspace {
  return {
    async prepare() {
      return null;
    },
    async write() {
      return null;
    },
    async read(_imageId, _path, fallback) {
      return fallback;
    },
    async check(_imageId, files, command, args, actor, revision, publish) {
      const record = operation(actor, "local_check", revision);
      publish(record);
      const root = await mkdtemp(join(tmpdir(), "scully-local-check-"));
      try {
        for (const file of files) {
          safePath(file.path);
          const target = join(root, file.path);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, file.content, { flag: "wx", mode: 0o600 });
        }
        const executable = await resolveExecutable(command);
        updated(record, { status: "submitted" }, publish);
        const output = await new Promise<CheckOutcome>((resolve) => {
          const child = spawn(executable, args, {
            cwd: root,
            shell: false,
            env: { PATH: process.env.PATH || "", HOME: root },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "",
            stderr = "";
          const append = (current: string, bytes: Buffer) =>
            (current + bytes.toString("utf8")).slice(0, 65_536);
          child.stdout.on("data", (bytes: Buffer) => {
            stdout = append(stdout, bytes);
          });
          child.stderr.on("data", (bytes: Buffer) => {
            stderr = append(stderr, bytes);
          });
          const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
          child.on("error", () => {
            clearTimeout(timeout);
            resolve({
              exitCode: null,
              stdout,
              stderr,
              passed: false,
              unknown: true,
            });
          });
          child.on("exit", (code) => {
            clearTimeout(timeout);
            resolve({
              exitCode: code,
              stdout,
              stderr,
              passed: code === 0,
              unknown: false,
            });
          });
        });
        updated(
          record,
          {
            status: output.unknown
              ? "unknown"
              : output.passed
                ? "complete"
                : "failed",
          },
          publish,
        );
        return output;
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    async reconcile() {
      return { status: "failed", resultImageId: null };
    },
  };
}

type SandboxClient = ReturnType<typeof sandboxClient>;
export function sandboxCollaborationWorkspace(
  client: SandboxClient,
): CollaborationWorkspace {
  async function wait(id: string): Promise<SandboxStatus> {
    for (let poll = 0; poll < 120; poll++) {
      const result = await client.status(id);
      if (result.terminal) return result;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new SandboxRequestError(false);
  }
  async function submit(
    imageId: string,
    attached: Record<
      string,
      { uuid: string; uid: number; gid: number; mode: string }
    >,
    command: string,
    args: string[],
    saveChanges: boolean,
    actor: string,
    revision: string,
    stage: string,
    publish: OperationUpdate,
    cwd = "/workspace",
  ) {
    const record = operation(actor, stage, revision);
    publish(record);
    try {
      const remoteId = await client.submit(
        {
          image: imageId,
          command,
          args,
          cwd,
          timeoutSeconds: 120,
          saveChanges,
          files: attached,
        },
        true,
      );
      updated(record, { remoteId, status: "submitted" }, publish);
      const result = await wait(remoteId);
      updated(
        record,
        {
          status: result.commandPassed ? "complete" : "failed",
          resultImageId: result.resultImage,
        },
        publish,
      );
      return result;
    } catch (error) {
      updated(
        record,
        { status: error instanceof SandboxRequestError ? "unknown" : "failed" },
        publish,
      );
      throw error;
    }
  }
  async function transfer(
    imageId: string,
    files: SourceFile[],
    actor: string,
    revision: string,
    publish: OperationUpdate,
  ) {
    let head = imageId;
    const transferBatch = async (batch: SourceFile[]) => {
      const attached: Record<
        string,
        { uuid: string; uid: number; gid: number; mode: string }
      > = {};
      for (const file of batch) {
        safePath(file.path);
        const upload = await client.upload(file.content);
        attached[`/workspace/${file.path}`] = {
          uuid: upload.uuid,
          uid: 0,
          gid: 0,
          mode: "0600",
        };
      }
      const result = await submit(
        head,
        attached,
        "/bin/true",
        [],
        true,
        actor,
        revision,
        "upload",
        publish,
      );
      if (!result.commandPassed || !result.resultImage)
        throw new Error(
          "Sandbox upload produced no inspectable image; the previous checkpoint is still usable",
        );
      await client.inspectImage(result.resultImage);
      head = result.resultImage;
    };
    let batch: SourceFile[] = [];
    let batchBytes = 0;
    for (const file of files) {
      safePath(file.path);
      const fileBytes = Buffer.byteLength(file.content);
      if (fileBytes <= 7 * 1024 * 1024) {
        if (batch.length && batchBytes + fileBytes > 128 * 1024 * 1024) {
          await transferBatch(batch);
          batch = [];
          batchBytes = 0;
        }
        batch.push(file);
        batchBytes += fileBytes;
        if (batch.length === 100) {
          await transferBatch(batch);
          batch = [];
          batchBytes = 0;
        }
        continue;
      }
      if (batch.length) {
        await transferBatch(batch);
        batch = [];
        batchBytes = 0;
      }
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const temporary = `scully-transfer-${randomUUID()}`;
      const attached: Record<
        string,
        { uuid: string; uid: number; gid: number; mode: string }
      > = {};
      let start = 0;
      let index = 0;
      while (start < file.content.length) {
        let end = Math.min(file.content.length, start + 3_000_000);
        if (
          end < file.content.length &&
          /[\uD800-\uDBFF]/.test(file.content[end - 1])
        )
          end--;
        let piece = file.content.slice(start, end);
        while (Buffer.byteLength(piece) > 7 * 1024 * 1024) {
          end = start + Math.floor((end - start) / 2);
          if (/[\uD800-\uDBFF]/.test(file.content[end - 1])) end--;
          piece = file.content.slice(start, end);
        }
        const upload = await client.upload(piece);
        attached[`/workspace/${temporary}/${String(index).padStart(4, "0")}`] =
          {
            uuid: upload.uuid,
            uid: 0,
            gid: 0,
            mode: "0600",
          };
        start = end;
        index++;
      }
      if (index > 128)
        throw new Error("Large Sandbox file requires too many transfer pieces");
      const target = `/workspace/${file.path}`;
      const tempPath = `/workspace/${temporary}`;
      const script = `set -eu; mkdir -p ${quote(`/workspace/${dirname(file.path)}`)}; cat ${quote(tempPath)}/* > ${quote(target)}; rm -r ${quote(tempPath)}`;
      const result = await submit(
        head,
        attached,
        "/bin/sh",
        ["-c", script],
        true,
        actor,
        revision,
        "upload",
        publish,
      );
      if (!result.commandPassed || !result.resultImage)
        throw new Error("Large Sandbox upload produced no usable checkpoint");
      await client.inspectImage(result.resultImage);
      head = result.resultImage;
    }
    if (batch.length) await transferBatch(batch);
    return head;
  }
  return {
    async prepare(files, imageId, actor, revision, publish) {
      if (!imageId) throw new Error("Choose a starting Sandbox image");
      await client.inspectImage(imageId);
      let head = imageId;
      try {
        if ((await client.listFiles(head)).length)
          throw new Error(
            "Choose a Sandbox image with an empty /workspace directory",
          );
      } catch (error) {
        if (!(error instanceof SandboxWorkspaceMissingError)) throw error;
        const result = await submit(
          head,
          {},
          "/bin/mkdir",
          ["-p", "/workspace"],
          true,
          actor,
          revision,
          "bootstrap",
          publish,
          "/",
        );
        if (!result.commandPassed || !result.resultImage)
          throw new Error("Sandbox workspace could not be created");
        await client.inspectImage(result.resultImage);
        head = result.resultImage;
        if ((await client.listFiles(head)).length)
          throw new Error("Created Sandbox workspace is not empty");
      }
      const prepared = await transfer(head, files, actor, revision, publish);
      for (const file of files)
        if ((await client.downloadFile(prepared, file.path)) !== file.content)
          throw new Error(
            `Saved Sandbox snapshot differs at ${file.path}; the base image was not accepted`,
          );
      return prepared;
    },
    async write(imageId, path, content, actor, revision, publish) {
      if (!imageId) throw new Error("No usable branch image is available");
      const next = await transfer(
        imageId,
        [{ path, content }],
        actor,
        revision,
        publish,
      );
      const observed = await client.downloadFile(next, path);
      if (observed !== content)
        throw new Error(
          "Saved Sandbox file differs from the requested change; branch head was not advanced",
        );
      return next;
    },
    async read(imageId, path) {
      if (!imageId) throw new Error("No usable branch image is available");
      return client.downloadFile(imageId, path);
    },
    async check(imageId, _files, command, args, actor, revision, publish) {
      if (!imageId) throw new Error("No usable branch image is available");
      const executable = await client.inspectExecutable(imageId, command);
      if (!executable)
        throw new Error(
          `The selected Sandbox image does not contain ${command}`,
        );
      const result = await submit(
        imageId,
        {},
        executable,
        args,
        false,
        actor,
        revision,
        "check",
        publish,
      );
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        passed: result.commandPassed,
        unknown: false,
      };
    },
    async reconcile(record) {
      if (!record.remoteId)
        throw new Error(
          "Submission has no operation ID. Inspect this project's Nebius operation history before another upload or check; the prior checkpoint remains usable.",
        );
      const result = await client.status(record.remoteId);
      if (result.resultImage) await client.inspectImage(result.resultImage);
      return {
        status: result.terminal
          ? result.commandPassed &&
            (record.stage !== "upload" || !!result.resultImage)
            ? "complete"
            : "failed"
          : "running",
        resultImageId: result.resultImage,
      };
    },
  };
}
