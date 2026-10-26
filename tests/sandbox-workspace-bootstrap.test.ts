// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { sandboxClient, SandboxCommand } from "../src/engine/sandbox";
import { SandboxWorkspaceMissingError } from "../src/engine/sandbox";
import { sandboxCollaborationWorkspace } from "../src/main/collaboration-workspace";

const base = "11111111-1111-1111-1111-111111111111";
const initialized = "22222222-2222-2222-2222-222222222222";
const uploaded = "33333333-3333-3333-3333-333333333333";
const bootstrapOperation = "44444444-4444-4444-4444-444444444444";
const uploadOperation = "55555555-5555-5555-5555-555555555555";
const fileId = "66666666-6666-6666-6666-666666666666";

it("creates an empty workspace checkpoint before uploading to a base image without one", async () => {
  const requests: SandboxCommand[] = [];
  const content = "export const value = 1;\n";
  const client = {
    inspectImage: async () => {},
    listFiles: async (image: string) => {
      if (image === base) throw new SandboxWorkspaceMissingError();
      return [];
    },
    submit: async (request: SandboxCommand) => {
      requests.push(request);
      return requests.length === 1 ? bootstrapOperation : uploadOperation;
    },
    status: async (id: string) => ({
      terminal: true,
      commandPassed: true,
      resultImage: id === bootstrapOperation ? initialized : uploaded,
    }),
    upload: async () => ({
      uuid: fileId,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: Buffer.byteLength(content),
    }),
    downloadFile: async () => content,
  } as unknown as ReturnType<typeof sandboxClient>;
  const stages: string[] = [];
  const result = await sandboxCollaborationWorkspace(client).prepare(
    [{ path: "main.ts", content }],
    base,
    "pearl",
    "reviewed-revision",
    (operation) => stages.push(operation.stage),
  );
  expect(result).toBe(uploaded);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    image: base,
    command: "/bin/mkdir",
    args: ["-p", "/workspace"],
    cwd: "/",
    saveChanges: true,
  });
  expect(requests[1]).toMatchObject({
    image: initialized,
    command: "/bin/true",
    cwd: "/workspace",
    saveChanges: true,
  });
  expect(stages).toContain("bootstrap");
  expect(stages).toContain("upload");
});

it("rejects a base image containing files without submitting an operation", async () => {
  const submit = vi.fn();
  const client = {
    inspectImage: async () => {},
    listFiles: async () => [{ name: "existing.txt" }],
    submit,
  } as unknown as ReturnType<typeof sandboxClient>;
  await expect(
    sandboxCollaborationWorkspace(client).prepare(
      [{ path: "main.ts", content: "value" }],
      base,
      "pearl",
      "reviewed-revision",
      () => {},
    ),
  ).rejects.toThrow(/empty \/workspace/);
  expect(submit).not.toHaveBeenCalled();
});
