// @vitest-environment node
import { expect, it, vi } from "vitest";
import { sandboxCollaborationWorkspace } from "../src/main/collaboration-workspace";
import { SandboxRequestError, type SandboxStatus } from "../src/engine/sandbox";

function status(
  id: string,
  image: string | null,
  passed = true,
): SandboxStatus {
  return {
    id,
    status: passed ? "SUCCESS" : "FAILED",
    terminal: true,
    commandPassed: passed,
    exitCode: passed ? 0 : 1,
    timedOut: false,
    signal: null,
    stdout: "",
    stderr: passed ? "" : "check failed",
    truncated: false,
    resultImage: image,
  };
}
function fixture() {
  const images = new Map<string, Map<string, string>>([
    ["base-image", new Map()],
  ]);
  const uploads = new Map<string, string>();
  const submissions: { image: string; files: string[]; command: string }[] = [];
  let counter = 0;
  const client = {
    inspectImage: vi.fn(async (image: string) => {
      if (!images.has(image)) throw new Error("Image missing");
    }),
    inspectExecutable: vi.fn(async () => "/usr/bin/npm"),
    upload: vi.fn(async (content: string) => {
      const id = `upload-${++counter}`;
      uploads.set(id, content);
      return { uuid: id };
    }),
    submit: vi.fn(
      async (request: {
        image: string;
        files: Record<string, { uuid: string }>;
        command: string;
      }) => {
        submissions.push({
          image: request.image,
          files: Object.keys(request.files),
          command: request.command,
        });
        const next = new Map(images.get(request.image));
        for (const [path, item] of Object.entries(request.files))
          next.set(path.replace(/^\/workspace\//, ""), uploads.get(item.uuid)!);
        const id = `operation-${++counter}`;
        images.set(`result-${id}`, next);
        return id;
      },
    ),
    status: vi.fn(async (id: string) => status(id, `result-${id}`)),
    downloadFile: vi.fn(
      async (image: string, path: string) => images.get(image)?.get(path) || "",
    ),
  };
  return {
    client,
    submissions,
    images,
    workspace: sandboxCollaborationWorkspace(client as never),
  };
}

it("creates one inspectable base and advances two independent Sandbox branches", async () => {
  const { client, submissions, workspace } = fixture();
  const updates: string[] = [];
  const publish = (record: { status: string }) => updates.push(record.status);
  const base = await workspace.prepare(
    [{ path: "app.ts", content: "base" }],
    "base-image",
    "project",
    "base-revision",
    publish as never,
  );
  const maya = await workspace.write(
    base,
    "app.ts",
    "Maya",
    "maya",
    "base-revision",
    publish as never,
  );
  const jun = await workspace.write(
    base,
    "tests/app.test.ts",
    "Jun",
    "jun",
    "base-revision",
    publish as never,
  );
  expect(base).toBeTruthy();
  expect(maya).not.toBe(jun);
  expect(submissions.slice(1).map((entry) => entry.image)).toEqual([
    base,
    base,
  ]);
  expect(await workspace.read(maya, "app.ts", "wrong")).toBe("Maya");
  expect(await workspace.read(jun, "app.ts", "wrong")).toBe("base");
  expect(updates).toContain("submitted");
  expect(updates).toContain("complete");
  expect(client.inspectImage).toHaveBeenCalledWith(maya);
});

it("keeps the prior branch when a command fails and reconciles uncertain status", async () => {
  const { client, workspace } = fixture();
  const base = await workspace.prepare(
    [{ path: "app.ts", content: "base" }],
    "base-image",
    "project",
    "base-revision",
    () => {},
  );
  vi.mocked(client.status).mockImplementation(async (id) =>
    status(id, `result-${id}`, false),
  );
  const outcome = await workspace.check(
    base,
    [{ path: "app.ts", content: "base" }],
    "npm",
    ["test"],
    "jun",
    "base-revision",
    () => {},
  );
  expect(outcome.passed).toBe(false);
  expect(await workspace.read(base, "app.ts", "wrong")).toBe("base");
  vi.mocked(client.submit).mockRejectedValueOnce(new SandboxRequestError(true));
  await expect(
    workspace.write(base, "app.ts", "new", "maya", "base-revision", () => {}),
  ).rejects.toThrow(/unknown/i);
  await expect(
    workspace.reconcile({
      id: "local",
      actor: "maya",
      stage: "upload",
      inputRevision: "base-revision",
      status: "unknown",
      remoteId: null,
      resultImageId: null,
      at: "now",
    }),
  ).rejects.toThrow(/operation history/);
});

it("rejects a base image whose saved files cannot be verified", async () => {
  const { client, workspace } = fixture();
  vi.mocked(client.downloadFile).mockResolvedValueOnce("different content");
  await expect(
    workspace.prepare(
      [{ path: "app.ts", content: "approved content" }],
      "base-image",
      "project",
      "base-revision",
      () => {},
    ),
  ).rejects.toThrow(/snapshot differs/);
});
