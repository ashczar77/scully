import { measured, noopSink, type MetricSink } from "../shared/telemetry";
import { createHash } from "node:crypto";
import type { CloudImageCatalog } from "../shared/cloud";
import { posix } from "node:path";
import { safePath } from "../shared/runs";

const endpoint = "https://api.tokenfactory.nebius.com/sandboxes/v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new Error("Invalid sandbox identifier");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid sandbox response");
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, limit: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > limit ||
    value.includes("\0")
  )
    throw new Error("Invalid sandbox input");
  return value;
}
export type SandboxCommand = {
  image: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutSeconds: number;
  saveChanges: boolean;
  files?: Record<
    string,
    { uuid: string; uid: number; gid: number; mode: string }
  >;
};
export function sandboxBody(value: SandboxCommand) {
  const image = uuid(value.image);
  const command = boundedText(value.command, 512);
  const cwd = boundedText(value.cwd, 512);
  if (
    !command.startsWith("/") ||
    !cwd.startsWith("/") ||
    cwd.split("/").includes("..")
  )
    throw new Error("Use absolute guest paths");
  if (
    !Array.isArray(value.args) ||
    value.args.length > 32 ||
    !Number.isInteger(value.timeoutSeconds) ||
    value.timeoutSeconds < 1 ||
    value.timeoutSeconds > 120 ||
    typeof value.saveChanges !== "boolean"
  )
    throw new Error("Invalid sandbox limits or persistence choice");
  const args = value.args.map((arg) => boundedText(arg, 2000));
  if (Buffer.byteLength(JSON.stringify(args)) > 16000)
    throw new Error("Sandbox arguments exceed the limit");
  const files = Object.create(null) as Record<
    string,
    { uuid: string; uid: number; gid: number; mode: string }
  >;
  const entries = Object.entries(value.files || {});
  if (entries.length > 128)
    throw new Error("Too many files in one sandbox transfer");
  for (const [path, file] of entries) {
    if (
      !/^\/workspace\/[A-Za-z0-9_./+-]{1,240}$/.test(path) ||
      path.split("/").includes("..")
    )
      throw new Error("Invalid guest file path");
    files[path] = { uuid: uuid(file.uuid), uid: 0, gid: 0, mode: "0600" };
  }
  return {
    image,
    command,
    args,
    cwd,
    shell: false,
    env: {},
    preserve_env: false,
    networking: { enabled: false },
    disposable: !value.saveChanges,
    timeout: value.timeoutSeconds,
    truncate_output_at: 65536,
    resources_limits: { max_layer_bytes: 268435456 },
    files,
  };
}
const statuses = [
  "PENDING",
  "ASSIGNED",
  "EXECUTING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
] as const;
export type SandboxStatus = {
  id: string;
  status: (typeof statuses)[number];
  terminal: boolean;
  commandPassed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  signal: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  resultImage: string | null;
};
function stream(value: unknown) {
  if (value == null) return { text: "", truncated: false };
  const v = record(value);
  if (
    typeof v.value !== "string" ||
    v.value.length > 90000 ||
    !["ascii", "base64"].includes(v.encoding as string) ||
    (v.truncated !== undefined && typeof v.truncated !== "boolean")
  )
    throw new Error("Invalid sandbox output");
  if (
    v.encoding === "base64" &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      v.value,
    )
  )
    throw new Error("Invalid sandbox output encoding");
  const bytes = Buffer.from(
    v.value,
    v.encoding === "base64" ? "base64" : "utf8",
  );
  return {
    text: bytes.subarray(0, 65536).toString("utf8"),
    truncated: v.truncated === true || bytes.length > 65536,
  };
}
export function parseSandboxStatus(
  value: unknown,
  expectedId: string,
): SandboxStatus {
  const v = record(value);
  if (
    uuid(v.uuid) !== uuid(expectedId) ||
    v.kind !== "instance" ||
    !statuses.includes(v.status as (typeof statuses)[number])
  )
    throw new Error("Unexpected sandbox operation");
  const status = v.status as (typeof statuses)[number];
  const result = v.metadata == null ? null : record(v.metadata).result;
  const r = result == null ? {} : record(result);
  const state = r.state == null ? {} : record(r.state);
  for (const key of ["exit_code", "signal"])
    if (state[key] != null && !Number.isSafeInteger(state[key]))
      throw new Error("Invalid process state");
  if (typeof state.signal === "number" && state.signal < -1)
    throw new Error("Invalid process state");
  if (state.timed_out !== undefined && typeof state.timed_out !== "boolean")
    throw new Error("Invalid process timeout");
  const out = stream(r.stdout),
    err = stream(r.stderr);
  const exitCode = typeof state.exit_code === "number" ? state.exit_code : null;
  const signal =
    typeof state.signal === "number" && state.signal > 0 ? state.signal : null;
  const timedOut = state.timed_out === true;
  return {
    id: expectedId,
    status,
    terminal: ["SUCCESS", "FAILED", "CANCELLED"].includes(status),
    commandPassed:
      status === "SUCCESS" && exitCode === 0 && !signal && !timedOut,
    exitCode,
    signal,
    timedOut,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    resultImage: v.result_image_uuid != null ? uuid(v.result_image_uuid) : null,
  };
}
export class SandboxRequestError extends Error {
  constructor(readonly submissionUncertain: boolean) {
    super(
      submissionUncertain
        ? "Sandbox submission outcome is unknown. No retry was made; inspect operation history before resubmitting."
        : "Sandbox status could not be read. Remote execution may continue. No retry or cancellation was made.",
    );
  }
}
export class SandboxHttpError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Sandbox ${operation} failed (HTTP ${status})`);
  }
}
export class SandboxWorkspaceMissingError extends Error {
  constructor() {
    super("The selected Sandbox image has no /workspace directory");
  }
}
export function imageTagPrefix(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("Invalid image search");
  return value.trim();
}
export function parseImageCatalog(value: unknown): CloudImageCatalog {
  const images = record(value).images;
  if (!Array.isArray(images) || images.length > 100)
    throw new Error("Invalid sandbox image catalog");
  const seen = new Set<string>();
  const parsed: CloudImageCatalog["images"] = [];
  for (const item of images) {
    const image = record(item);
    const id = uuid(image.uuid);
    if (
      typeof image.tag !== "string" ||
      !image.tag.trim() ||
      Buffer.byteLength(image.tag) > 160 ||
      /[\x00-\x1f\x7f]/.test(image.tag)
    )
      throw new Error("Invalid sandbox image tag");
    if (!seen.has(id)) {
      parsed.push({ uuid: id, tag: image.tag });
      seen.add(id);
    }
  }
  return { images: parsed, limited: images.length === 100 };
}
export function sandboxClient(
  config: { key: string; projectId: string },
  fetcher: typeof fetch = fetch,
  sink: MetricSink = noopSink,
) {
  const key = boundedText(config.key, 4096),
    project = boundedText(config.projectId, 128);
  if (!key || /[\r\n]/.test(key) || !/^[a-zA-Z0-9_-]+$/.test(project))
    throw new Error("Invalid sandbox credentials");
  async function request(path: string, body?: object) {
    const response = await fetcher(endpoint + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${key}`,
        Project: project,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status !== (body ? 201 : 200) || !response.body) {
      await response.body?.cancel();
      const operation = path.startsWith("/inspect/")
        ? "image inspection"
        : path.startsWith("/images")
          ? "image catalog"
          : path.startsWith("/operations/")
            ? "operation status"
            : "request";
      throw new SandboxHttpError(response.status, operation);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 250000) throw new Error("Sandbox response limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  return {
    async listFiles(imageId: string, directory = "/workspace") {
      const id = uuid(imageId);
      if (directory !== "/workspace" && !directory.startsWith("/workspace/"))
        throw new Error("Image inspection is outside the project workspace");
      let response: unknown;
      try {
        response = await request(
          `/inspect/${id}/list?${new URLSearchParams({ path: directory })}`,
        );
      } catch (error) {
        if (
          directory === "/workspace" &&
          error instanceof SandboxHttpError &&
          [404, 422].includes(error.status)
        ) {
          const root = record(await request(`/inspect/${id}/list?path=%2F`));
          if (
            root.path === "/" &&
            Array.isArray(root.files) &&
            !root.files.some((item) => {
              const entry = record(item);
              return entry.path === "workspace" && entry.is_dir === true;
            })
          )
            throw new SandboxWorkspaceMissingError();
        }
        throw error;
      }
      const value = record(response);
      if (
        value.path !== directory ||
        !Array.isArray(value.files) ||
        value.files.length > 5000
      )
        throw new Error("Invalid image listing");
      return value.files.map((entry) => {
        const file = record(entry);
        if (
          typeof file.path !== "string" ||
          !file.path ||
          file.path.includes("/") ||
          typeof file.is_dir !== "boolean" ||
          typeof file.is_regular !== "boolean" ||
          typeof file.is_symlink !== "boolean" ||
          !Number.isSafeInteger(file.size)
        )
          throw new Error("Invalid image file metadata");
        return {
          name: file.path,
          directory: file.is_dir,
          regular: file.is_regular,
          symlink: file.is_symlink,
          size: file.size as number,
        };
      });
    },
    async downloadFile(imageId: string, path: string) {
      const id = uuid(imageId);
      safePath(path);
      const response = await fetcher(
        `${endpoint}/inspect/${id}/download?${new URLSearchParams({ path: `/workspace/${path}` })}`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${key}`, Project: project },
        },
      );
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error("Saved file cannot be inspected");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 8_388_608)
            throw new Error("Saved file exceeds the inspection byte limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      if (content.includes("\0"))
        throw new Error("Saved file is not supported text");
      return content;
    },
    inspectImage(imageId: string): Promise<void> {
      return measured(
        "sandbox.inspect",
        async () => {
          const id = uuid(imageId);
          try {
            const value = record(await request(`/inspect/${id}/list?path=%2F`));
            if (
              value.path !== "/" ||
              !Array.isArray(value.files) ||
              value.files.length > 5000
            )
              throw new Error("Invalid image listing");
          } catch {
            throw new Error(
              "Saved environment is unavailable or cannot be inspected. Choose another starting image.",
            );
          }
        },
        sink,
      );
    },
    inspectExecutable(imageId: string, name: string): Promise<string | null> {
      return measured(
        "sandbox.inspect",
        async () => {
          const id = uuid(imageId);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(name))
            throw new Error("Invalid executable name");
          const directories = [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/local/sbin",
            "/usr/sbin",
            "/sbin",
          ];
          const cache = new Map<string, unknown[]>();
          async function listing(directory: string): Promise<unknown[] | null> {
            if (cache.has(directory)) return cache.get(directory)!;
            if (cache.size >= 12) throw new Error("Image inspection limit");
            const query = new URLSearchParams({ path: directory });
            let response: Response;
            try {
              response = await fetcher(
                `${endpoint}/inspect/${id}/list?${query}`,
                {
                  method: "GET",
                  redirect: "error",
                  signal: AbortSignal.timeout(20000),
                  headers: {
                    Authorization: `Bearer ${key}`,
                    Project: project,
                    Accept: "application/json",
                  },
                },
              );
            } catch {
              throw new Error("Image inspection unavailable");
            }
            if (response.status === 404 || response.status === 422) {
              await response.body?.cancel();
              cache.set(directory, []);
              return [];
            }
            if (response.status !== 200 || !response.body) {
              await response.body?.cancel();
              throw new Error("Image inspection unavailable");
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > 1_000_000) throw new Error("Image listing limit");
                chunks.push(value);
              }
            } finally {
              await reader.cancel();
            }
            let result: Record<string, unknown>;
            try {
              result = record(
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
              );
            } catch {
              throw new Error("Invalid image listing");
            }
            if (
              result.path !== directory ||
              !Array.isArray(result.files) ||
              result.files.length > 5000
            )
              throw new Error("Invalid image listing");
            cache.set(directory, result.files);
            return result.files;
          }
          async function isExecutable(start: string): Promise<boolean> {
            let current = start;
            const seen = new Set<string>();
            for (let depth = 0; depth < 5; depth++) {
              if (
                seen.has(current) ||
                !current.startsWith("/") ||
                current.length > 512
              )
                return false;
              seen.add(current);
              const directory = posix.dirname(current);
              const base = posix.basename(current);
              const entry = (await listing(directory))
                ?.map(record)
                .find((item) => item.path === base);
              if (!entry) return false;
              if (
                !Number.isSafeInteger(entry.mode) ||
                (entry.mode as number) < 0 ||
                typeof entry.is_regular !== "boolean" ||
                typeof entry.is_symlink !== "boolean"
              )
                throw new Error("Invalid image file metadata");
              if (entry.is_regular)
                return ((entry.mode as number) & 0o111) !== 0;
              if (
                !entry.is_symlink ||
                typeof entry.symlink_to !== "string" ||
                !entry.symlink_to ||
                entry.symlink_to.length > 512 ||
                /[\x00-\x1f\x7f]/.test(entry.symlink_to)
              )
                return false;
              current = posix.resolve(directory, entry.symlink_to);
            }
            return false;
          }
          for (const directory of directories) {
            const candidate = `${directory}/${name}`;
            if (await isExecutable(candidate)) return candidate;
          }
          return null;
        },
        sink,
      );
    },
    images(tagPrefix = ""): Promise<CloudImageCatalog> {
      return measured(
        "sandbox.images",
        async () => {
          const prefix = imageTagPrefix(tagPrefix);
          const query = new URLSearchParams({ limit: "100", tagged: "1" });
          if (prefix) query.set("tag", prefix);
          try {
            return parseImageCatalog(await request(`/images?${query}`));
          } catch {
            throw new Error(
              "Sandbox images could not be loaded. Check project access and try again.",
            );
          }
        },
        sink,
      );
    },
    upload(
      content: string,
    ): Promise<{ uuid: string; sha256: string; size: number }> {
      return measured(
        "sandbox.upload",
        async () => {
          boundedText(content, 8_388_608);
          const bytes = Buffer.from(content, "utf8");
          const digest = createHash("sha256").update(bytes).digest("hex");
          try {
            const response = await fetcher(endpoint + "/files", {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(20000),
              headers: {
                Authorization: `Bearer ${key}`,
                Project: project,
                "Content-Type": "application/octet-stream",
              },
              body: bytes,
            });
            if (response.status !== 201 || !response.body) {
              await response.body?.cancel();
              throw new Error("Upload failed");
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.length;
                if (length > 4096) throw new Error("Upload response limit");
                chunks.push(value);
              }
            } finally {
              await reader.cancel();
            }
            const value = record(
              JSON.parse(Buffer.concat(chunks).toString("utf8")),
            );
            if (value.sha256 !== digest || value.size !== bytes.length)
              throw new Error("Upload verification failed");
            return {
              uuid: uuid(value.uuid),
              sha256: digest,
              size: bytes.length,
            };
          } catch {
            throw new Error(
              "Sandbox file upload failed or could not be verified. Uploaded data may remain on the service; no command was submitted.",
            );
          }
        },
        sink,
      );
    },
    submit(value: SandboxCommand, approved: boolean): Promise<string> {
      return measured(
        "sandbox.submit",
        async () => {
          if (approved !== true)
            throw new Error("Explicit sandbox execution approval required");
          const body = sandboxBody(value);
          try {
            return uuid(record(await request("/instances", body)).uuid);
          } catch {
            throw new SandboxRequestError(true);
          }
        },
        sink,
      );
    },
    status(id: string): Promise<SandboxStatus> {
      return measured(
        "sandbox.status",
        async () => {
          uuid(id);
          try {
            return parseSandboxStatus(await request(`/operations/${id}`), id);
          } catch {
            throw new SandboxRequestError(false);
          }
        },
        sink,
      );
    },
  };
}
