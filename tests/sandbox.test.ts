// @vitest-environment node
import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  sandboxBody,
  sandboxClient,
  parseSandboxStatus,
  parseImageCatalog,
  SandboxRequestError,
  type SandboxCommand,
} from "../src/engine/sandbox";
const id = "12345678-9abc-baba-deda-0123456789ab";
const image = "12345678-9abc-baba-deda-0123456789ac";
const command: SandboxCommand = {
  image,
  command: "/bin/echo",
  args: ["hello; not a shell"],
  cwd: "/workspace",
  timeoutSeconds: 30,
  saveChanges: false,
};
const config = { key: "private-fixture-token", projectId: "aiproject-fixture" };
it("confirms a checkpoint is readable with a bounded authenticated request", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ path: "/", files: [] })),
    );
  const metrics = vi.fn();
  await sandboxClient(config, fetcher, metrics).inspectImage(image);
  expect(fetcher).toHaveBeenCalledWith(
    `https://api.tokenfactory.nebius.com/sandboxes/v1/inspect/${image}/list?path=%2F`,
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: expect.objectContaining({ Project: config.projectId }),
    }),
  );
  expect(metrics).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "sandbox.inspect",
      outcome: "returned",
    }),
  );
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ path: "wrong", files: [] })),
  );
  await expect(
    sandboxClient(config, fetcher).inspectImage(image),
  ).rejects.toThrow("Saved environment is unavailable");
});
it("verifies an image executable without starting a sandbox", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        path: "/usr/local/bin",
        files: [
          { path: "node", mode: 0o100755, is_regular: true, is_symlink: false },
        ],
      }),
    ),
  );
  await expect(
    sandboxClient(config, fetcher).inspectExecutable(image, "node"),
  ).resolves.toBe("/usr/local/bin/node");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain(
    `/inspect/${image}/list?path=%2Fusr%2Flocal%2Fbin`,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "GET",
    headers: { Project: config.projectId },
  });
});
it("resolves short image symlinks and rejects unverified file metadata", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        path: "/usr/local/bin",
        files: [
          {
            path: "python",
            mode: 0o120777,
            is_regular: false,
            is_symlink: true,
            symlink_to: "python3",
          },
          {
            path: "python3",
            mode: 0o100755,
            is_regular: true,
            is_symlink: false,
          },
        ],
      }),
    ),
  );
  await expect(
    sandboxClient(config, fetcher).inspectExecutable(image, "python"),
  ).resolves.toBe("/usr/local/bin/python");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const absent = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
  await expect(
    sandboxClient(config, absent).inspectExecutable(image, "python"),
  ).resolves.toBeNull();
  expect(absent).toHaveBeenCalledTimes(6);
});
it("does not accept a non-executable file or expose failed inspection details", async () => {
  const nonExecutable = vi.fn().mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify({
          path: new URL(url).searchParams.get("path"),
          files: [
            {
              path: "node",
              mode: 0o100644,
              is_regular: true,
              is_symlink: false,
            },
          ],
        }),
      ),
  );
  await expect(
    sandboxClient(config, nonExecutable).inspectExecutable(image, "node"),
  ).resolves.toBeNull();
  const failed = vi
    .fn()
    .mockResolvedValue(
      new Response("private provider detail", { status: 500 }),
    );
  await expect(
    sandboxClient(config, failed).inspectExecutable(image, "node"),
  ).rejects.toThrow("Image inspection unavailable");
  expect(failed).toHaveBeenCalledTimes(1);
});
it("lists tagged public images with bounded prefix search and immutable IDs", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        images: [
          { uuid: image, tag: "node:22", created_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    ),
  );
  const catalog = await sandboxClient(config, fetcher).images("node");
  expect(catalog).toEqual({
    images: [{ uuid: image, tag: "node:22" }],
    limited: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.tokenfactory.nebius.com/sandboxes/v1/images?limit=100&tagged=1&tag=node",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "GET",
    redirect: "error",
  });
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
    `Bearer ${config.key}`,
  );
  expect(fetcher.mock.calls[0][1].headers.Project).toBe(config.projectId);
  await expect(
    sandboxClient(config, fetcher).images("bad\nquery"),
  ).rejects.toThrow("Invalid image search");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("fails closed on malformed catalogs without exposing response contents", async () => {
  expect(() =>
    parseImageCatalog({ images: [{ uuid: "bad", tag: "node" }] }),
  ).toThrow();
  expect(() =>
    parseImageCatalog({
      images: Array(101).fill({ uuid: image, tag: "node" }),
    }),
  ).toThrow();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ images: [{ uuid: image, tag: "bad\nlabel" }] }),
      ),
    );
  await expect(sandboxClient(config, fetcher).images("")).rejects.toThrow(
    "could not be loaded",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("uploads exact bytes, verifies digest and never sends a command on upload failure", async () => {
  const content = "one\n";
  const sha256 = createHash("sha256").update(content).digest("hex");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ uuid: id, sha256, size: 4 }), {
      status: 201,
    }),
  );
  const uploaded = await sandboxClient(config, fetcher).upload(content);
  expect(uploaded).toEqual({ uuid: id, sha256, size: 4 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain("/sandboxes/v1/files");
  expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBe(
    "application/octet-stream",
  );
  expect(Buffer.from(fetcher.mock.calls[0][1].body).toString()).toBe(content);
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ uuid: id, sha256: "wrong", size: 4 }), {
      status: 201,
    }),
  );
  await expect(sandboxClient(config, fetcher).upload(content)).rejects.toThrow(
    "could not be verified",
  );
});
const result = (exit = 0) => ({
  uuid: id,
  kind: "instance",
  status: "SUCCESS",
  result_image_uuid: image,
  metadata: {
    result: {
      state: { exit_code: exit, timed_out: false, signal: 0 },
      stdout: { encoding: "base64", value: "aGVsbG8=", truncated: false },
      stderr: { encoding: "ascii", value: "" },
    },
  },
});
it("submits one bounded direct request with separate auth and explicit persistence", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ uuid: id }), { status: 201 }),
    );
  const client = sandboxClient(config, fetcher);
  expect(await client.submit(command, true)).toBe(id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(
    "https://api.tokenfactory.nebius.com/sandboxes/v1/instances",
  );
  expect(options.redirect).toBe("error");
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers.Authorization).toBe(`Bearer ${config.key}`);
  expect(options.headers.Project).toBe(config.projectId);
  expect(options.body).not.toContain(config.key);
  expect(JSON.parse(options.body)).toMatchObject({
    image,
    shell: false,
    networking: { enabled: false },
    disposable: true,
    env: {},
    preserve_env: false,
    timeout: 30,
    truncate_output_at: 65536,
  });
  expect(sandboxBody({ ...command, saveChanges: true }).disposable).toBe(false);
});
it("rejects missing consent and unsafe or oversized input without network access", async () => {
  const fetcher = vi.fn();
  const client = sandboxClient(config, fetcher);
  await expect(client.submit(command, false)).rejects.toThrow("approval");
  for (const patch of [
    { image: "tag:latest" },
    { command: "echo hello" },
    { cwd: "../host" },
    { cwd: "/a/../b" },
    { timeoutSeconds: 121 },
    { saveChanges: undefined },
    { args: Array(33).fill("x") },
    { args: ["\0"] },
    { args: ["x".repeat(2001)] },
  ])
    await expect(
      client.submit({ ...command, ...patch } as SandboxCommand, true),
    ).rejects.toThrow();
  await expect(client.status("../../secrets")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(() =>
    sandboxClient({ ...config, key: "bad\r\nheader" }, fetcher),
  ).toThrow();
});
it.each([0, 1])("separates operation success from process exit %i", (exit) => {
  const parsed = parseSandboxStatus(result(exit), id);
  expect(parsed.terminal).toBe(true);
  expect(parsed.commandPassed).toBe(exit === 0);
  expect(parsed.stdout).toBe("hello");
  expect(parsed.resultImage).toBe(image);
});
it("does not call pending, cancelled, signalled, missing-state or timed-out runs passed", () => {
  for (const status of [
    "PENDING",
    "ASSIGNED",
    "EXECUTING",
    "FAILED",
    "CANCELLED",
  ])
    expect(parseSandboxStatus({ ...result(), status }, id).commandPassed).toBe(
      false,
    );
  for (const state of [
    {},
    { exit_code: 0, timed_out: true },
    { exit_code: 0, signal: 9 },
  ]) {
    const base = result();
    const v = {
      ...base,
      metadata: { result: { ...base.metadata.result, state } },
    };
    expect(parseSandboxStatus(v, id).commandPassed).toBe(false);
  }
});
it("bounds output and rejects malformed operation identifiers and encodings", () => {
  const v = result();
  v.metadata.result.stdout = {
    encoding: "ascii",
    value: "x".repeat(70000),
    truncated: false,
  };
  const parsed = parseSandboxStatus(v, id);
  expect(parsed.stdout.length).toBe(65536);
  expect(parsed.truncated).toBe(true);
  expect(() => parseSandboxStatus({ ...result(), uuid: image }, id)).toThrow();
  expect(() =>
    parseSandboxStatus({ ...result(), status: "NEW_UNKNOWN" }, id),
  ).toThrow();
  v.metadata.result.stdout = {
    encoding: "base64",
    value: "%%%%",
    truncated: false,
  };
  expect(() => parseSandboxStatus(v, id)).toThrow();
});
it.each([401, 429, 500, 302])(
  "does not retry or echo HTTP %i error bodies",
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(config.key, { status }));
    const client = sandboxClient(config, fetcher);
    const error = await client.submit(command, true).catch((e) => e);
    expect(error).toBeInstanceOf(SandboxRequestError);
    expect(error.submissionUncertain).toBe(true);
    expect(error.message).not.toContain(config.key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("reports uncertain submission on transport failure without retry or cancellation", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error(config.key));
  await expect(
    sandboxClient(config, fetcher).submit(command, true),
  ).rejects.toMatchObject({ submissionUncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reads exactly one status and emits content-free metrics even with a failing sink", async () => {
  const sink = vi.fn(() => {
    throw new Error("metrics unavailable");
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(result())));
  expect(
    (await sandboxClient(config, fetcher, sink).status(id)).commandPassed,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.tokenfactory.nebius.com/sandboxes/v1/operations/${id}`,
  );
  expect(sink).toHaveBeenCalledWith({
    version: 1,
    operation: "sandbox.status",
    outcome: "returned",
    durationMs: expect.any(Number),
  });
});
it("rejects oversized responses without a second request", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("x".repeat(250001)));
  await expect(sandboxClient(config, fetcher).status(id)).rejects.toMatchObject(
    { submissionUncertain: false },
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
