// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CloudManager } from "../src/main/cloud-manager";
import { Store } from "../src/main/store";
import { commandRevision } from "../src/engine/revision";
import { sandboxClient } from "../src/engine/sandbox";
import type { Run } from "../src/shared/runs";

const image = "12345678-9abc-baba-deda-0123456789ac";
const operation = "12345678-9abc-baba-deda-0123456789ab";
const checkpointImage = "12345678-9abc-baba-deda-0123456789ad";
async function fixture(failSubmit = false) {
  const root = await mkdtemp(join(tmpdir(), "scully-cloud-fixture-"));
  const store = new Store(join(root, "db.sqlite"));
  const task = store.createTask({
    title: "Cloud fixture",
    description: "",
    mode: "work",
  });
  const run: Run = {
    id: "run",
    taskId: task.id,
    sourceName: "Fixture",
    files: [],
    status: "complete",
    events: [],
    plan: "",
    drafts: [{ path: "test.js", content: "console.log(1)", before: null }],
    findings: [],
    checks: [],
    error: "",
    calls: 0,
    model: "",
    outputTokens: 0,
    commands: [
      {
        id: "command",
        revision: "",
        decision: "pending",
        executable: "node",
        args: ["test.js"],
        cwd: ".",
        reason: "Fixture",
        timeoutSeconds: 20,
      },
    ],
  };
  run.commands![0].revision = commandRevision(run);
  store.saveRun(run);
  const fetcher = vi
    .fn()
    .mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes("/images?")) {
        return new Response(
          JSON.stringify({ images: [{ uuid: image, tag: "node:22" }] }),
          { status: 200 },
        );
      }
      if (url.includes("/inspect/") && url.includes("/list?")) {
        return new Response(
          JSON.stringify({
            path: new URL(url).searchParams.get("path"),
            files: [
              {
                path: "node",
                mode: 0o100755,
                is_regular: true,
                is_symlink: false,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/files")) {
        const body = Buffer.from(options.body as Buffer);
        const { createHash } = await import("node:crypto");
        return new Response(
          JSON.stringify({
            uuid: image,
            sha256: createHash("sha256").update(body).digest("hex"),
            size: body.length,
          }),
          { status: 201 },
        );
      }
      if (url.endsWith("/instances")) {
        if (failSubmit) throw new Error("fixture transport failure");
        return new Response(JSON.stringify({ uuid: operation }), {
          status: 201,
        });
      }
      return new Response(
        JSON.stringify({
          uuid: operation,
          kind: "instance",
          status: "SUCCESS",
          result_image_uuid: checkpointImage,
          metadata: {
            result: {
              state: { exit_code: 0 },
              stdout: { encoding: "ascii", value: "passed" },
            },
          },
        }),
        { status: 200 },
      );
    });
  const factory = ((
    config: { key: string; projectId: string },
    _fetcher: typeof fetch,
    sink: Parameters<typeof sandboxClient>[2],
  ) => sandboxClient(config, fetcher, sink)) as typeof sandboxClient;
  const manager = new CloudManager(
    store,
    () => {},
    () => {},
    factory,
  );
  manager.configure({
    key: "private-fixture-token",
    projectId: "aiproject-fixture",
  });
  await manager.images("");
  fetcher.mockClear();
  return {
    root,
    store,
    manager,
    run,
    fetcher,
    factory,
    async close() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
it("marks only an exact inspected image executable as verified", async () => {
  const c = await fixture();
  try {
    expect(
      await c.manager.resolveExecutable("run", "command", image),
    ).toMatchObject({ path: "/usr/local/bin/node" });
    expect(
      c.manager.review("run", "command", image, "/usr/local/bin/node")
        .executableVerified,
    ).toBe(true);
    expect(
      c.manager.review("run", "command", image, "/custom/node")
        .executableVerified,
    ).toBe(false);
    expect(c.fetcher).toHaveBeenCalledTimes(1);
    await c.manager.images("");
    expect(
      c.manager.review("run", "command", image, "/usr/local/bin/node")
        .executableVerified,
    ).toBe(false);
  } finally {
    await c.close();
  }
});
it("saves an approved environment and branches twice from its immutable image after restart", async () => {
  const c = await fixture();
  let reopened: Store | undefined;
  try {
    const preparation = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
      { saveChanges: true },
    );
    const submitted = await c.manager.submit(preparation.token, true);
    const parentId = submitted.cloudExecutions![0].id;
    await c.manager.refresh("run", parentId);
    reopened = new Store(join(c.root, "db.sqlite"));
    const recovered = reopened.getRun("run").cloudExecutions![0];
    expect(recovered).toMatchObject({
      saveChanges: true,
      resultImage: checkpointImage,
      commandPassed: true,
    });
    const manager = new CloudManager(
      reopened,
      () => {},
      () => {},
      c.factory,
    );
    manager.configure({
      key: "private-fixture-token",
      projectId: "aiproject-fixture",
    });
    expect(() =>
      manager.review("run", "command", checkpointImage, "/usr/local/bin/node", {
        parentExecutionId: parentId,
      }),
    ).toThrow("Inspect the saved environment");
    for (let branch = 0; branch < 2; branch++) {
      const resolution = await manager.resolveExecutable(
        "run",
        "command",
        checkpointImage,
        parentId,
      );
      const review = manager.review(
        "run",
        "command",
        checkpointImage,
        resolution.path!,
        { parentExecutionId: parentId },
      );
      expect(review).toMatchObject({
        image: checkpointImage,
        parentExecutionId: parentId,
        saveChanges: false,
      });
      if (branch === 0) {
        const before = c.fetcher.mock.calls.length;
        await expect(manager.submit(review.token, false)).rejects.toThrow(
          "approval",
        );
        expect(c.fetcher.mock.calls).toHaveLength(before);
      }
      const fresh = manager.review(
        "run",
        "command",
        checkpointImage,
        resolution.path!,
        { parentExecutionId: parentId },
      );
      await manager.submit(fresh.token, true);
    }
    const bodies = c.fetcher.mock.calls
      .filter(([url]) => url.endsWith("/instances"))
      .map(([, options]) => JSON.parse(options.body));
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({ image, disposable: false });
    for (const body of bodies.slice(1)) {
      expect(body).toMatchObject({
        image: checkpointImage,
        disposable: true,
        shell: false,
        networking: { enabled: false },
      });
      expect(Object.keys(body.files)).toEqual(["/workspace/test.js"]);
    }
    await manager.refresh("run", parentId);
    const history = reopened.getRun("run").cloudExecutions!;
    expect(history.map((item) => item.parentExecutionId)).toEqual([
      undefined,
      parentId,
      parentId,
    ]);
    expect(history[0].resultImage).toBe(checkpointImage);
    expect(history.slice(1).every((item) => item.resultImage === null)).toBe(
      true,
    );
    for (let index = 0; index < 2; index++) {
      const extra = manager.review(
        "run",
        "command",
        checkpointImage,
        "/usr/local/bin/node",
        { parentExecutionId: parentId },
      );
      await manager.submit(extra.token, true);
    }
    expect(() =>
      manager.review("run", "command", checkpointImage, "/usr/local/bin/node", {
        parentExecutionId: parentId,
      }),
    ).toThrow("five-cloud-check limit");
  } finally {
    reopened?.close();
    await c.close();
  }
});
it.each([
  { returnedImage: null, exitCode: 0 },
  { returnedImage: image, exitCode: 0 },
  { returnedImage: checkpointImage, exitCode: 1 },
])(
  "keeps checkpoint availability separate from command outcome: $returnedImage / $exitCode",
  async ({ returnedImage, exitCode }) => {
    const c = await fixture();
    try {
      const review = c.manager.review(
        "run",
        "command",
        image,
        "/usr/local/bin/node",
        { saveChanges: true },
      );
      const submitted = await c.manager.submit(review.token, true);
      const parentId = submitted.cloudExecutions![0].id;
      c.fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uuid: operation,
            kind: "instance",
            status: "SUCCESS",
            result_image_uuid: returnedImage,
            metadata: { result: { state: { exit_code: exitCode } } },
          }),
        ),
      );
      const updated = await c.manager.refresh("run", parentId);
      expect(updated.cloudExecutions![0]).toMatchObject({
        resultImage: returnedImage,
        commandPassed: exitCode === 0,
      });
      if (returnedImage) {
        await expect(
          c.manager.resolveExecutable(
            "run",
            "command",
            returnedImage,
            parentId,
          ),
        ).resolves.toMatchObject({ path: "/usr/local/bin/node" });
      } else {
        await expect(
          c.manager.resolveExecutable("run", "command", image, parentId),
        ).rejects.toThrow("Saved environment");
      }
    } finally {
      await c.close();
    }
  },
);
it("rejects foreign, forged and stale checkpoints before any provider request", async () => {
  const c = await fixture();
  try {
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
      { saveChanges: true },
    );
    const submitted = await c.manager.submit(review.token, true);
    const parentId = submitted.cloudExecutions![0].id;
    await c.manager.refresh("run", parentId);
    c.fetcher.mockClear();
    await expect(
      c.manager.resolveExecutable("run", "command", image, parentId),
    ).rejects.toThrow("Saved environment");
    await expect(
      c.manager.resolveExecutable(
        "run",
        "command",
        checkpointImage,
        "forged-parent",
      ),
    ).rejects.toThrow("Saved environment");
    c.manager.configure({
      key: "other-fixture-token",
      projectId: "other-project",
    });
    await expect(
      c.manager.resolveExecutable("run", "command", checkpointImage, parentId),
    ).rejects.toThrow("Saved environment");
    c.manager.configure({
      key: "private-fixture-token",
      projectId: "aiproject-fixture",
    });
    const changed = c.store.getRun("run");
    changed.drafts[0].content = "different revision";
    changed.commands![0].revision = commandRevision(changed);
    c.store.saveRun(changed);
    await expect(
      c.manager.resolveExecutable("run", "command", checkpointImage, parentId),
    ).rejects.toThrow("stale");
    expect(c.fetcher).not.toHaveBeenCalled();
  } finally {
    await c.close();
  }
});
it("refuses an inaccessible checkpoint and validates persistence choices", async () => {
  const c = await fixture();
  try {
    for (const options of [
      { saveChanges: "yes" },
      { parentExecutionId: 12 },
      { saveChanges: true, override: true },
      null,
    ]) {
      expect(() =>
        c.manager.review(
          "run",
          "command",
          image,
          "/usr/local/bin/node",
          options,
        ),
      ).toThrow("Invalid cloud review options");
    }
    expect(c.fetcher).not.toHaveBeenCalled();
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
      { saveChanges: true },
    );
    const submitted = await c.manager.submit(review.token, true);
    const parentId = submitted.cloudExecutions![0].id;
    await c.manager.refresh("run", parentId);
    c.fetcher.mockClear();
    c.fetcher.mockResolvedValueOnce(
      new Response("private error detail", { status: 404 }),
    );
    await expect(
      c.manager.resolveExecutable("run", "command", checkpointImage, parentId),
    ).rejects.toThrow("Saved environment is unavailable");
    expect(() =>
      c.manager.review("run", "command", checkpointImage, "/custom/node", {
        parentExecutionId: parentId,
      }),
    ).toThrow("Inspect the saved environment");
    expect(c.fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await c.close();
  }
});
it("rechecks the saved parent before uploading a reviewed branch", async () => {
  const c = await fixture();
  try {
    const preparation = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
      { saveChanges: true },
    );
    const submitted = await c.manager.submit(preparation.token, true);
    const parentId = submitted.cloudExecutions![0].id;
    const finished = await c.manager.refresh("run", parentId);
    await c.manager.resolveExecutable(
      "run",
      "command",
      checkpointImage,
      parentId,
    );
    const branch = c.manager.review(
      "run",
      "command",
      checkpointImage,
      "/usr/local/bin/node",
      { parentExecutionId: parentId },
    );
    c.store.updateCloudExecution("run", {
      ...finished.cloudExecutions![0],
      resultImage: null,
    });
    c.fetcher.mockClear();
    await expect(c.manager.submit(branch.token, true)).rejects.toThrow(
      "Saved environment",
    );
    expect(c.fetcher).not.toHaveBeenCalled();
  } finally {
    await c.close();
  }
});
it("requires one-use review, uploads the exact snapshot and persists an operation for manual refresh", async () => {
  const c = await fixture();
  try {
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    expect(review.files).toHaveLength(1);
    expect(review.files[0].path).toBe("test.js");
    await expect(c.manager.submit(review.token, false)).rejects.toThrow(
      "approval",
    );
    expect(c.fetcher).not.toHaveBeenCalled();
    const accepted = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    const submitted = await c.manager.submit(accepted.token, true);
    expect(submitted.cloudExecutions![0].status).toBe("submitted");
    expect(submitted.cloudExecutions![0].operationId).toBe(operation);
    const reopened = new Store(join(c.root, "db.sqlite"));
    expect(reopened.getRun("run").cloudExecutions![0].operationId).toBe(
      operation,
    );
    expect(JSON.stringify(reopened.getRun("run"))).not.toContain(
      "private-fixture-token",
    );
    reopened.close();
    expect(c.fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(c.fetcher.mock.calls[1][1].body);
    expect(body.files["/workspace/test.js"].uuid).toBe(image);
    expect(body.networking).toEqual({ enabled: false });
    expect(body.disposable).toBe(true);
    expect(
      (await c.manager.refresh("run", submitted.cloudExecutions![0].id))
        .cloudExecutions![0],
    ).toMatchObject({
      status: "complete",
      commandPassed: true,
      stdout: "passed",
      resultImage: null,
    });
    await expect(c.manager.submit(accepted.token, true)).rejects.toThrow(
      "fresh",
    );
  } finally {
    await c.close();
  }
});
it("does not upload after stale review and never retries uncertain submission", async () => {
  const c = await fixture(true);
  try {
    const stale = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    const changed = c.store.getRun("run");
    changed.drafts[0].content = "changed";
    changed.commands![0].revision = commandRevision(changed);
    c.store.saveRun(changed);
    await expect(c.manager.submit(stale.token, true)).rejects.toThrow();
    expect(c.fetcher).not.toHaveBeenCalled();
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    const result = await c.manager.submit(review.token, true);
    expect(result.cloudExecutions![0]).toMatchObject({
      status: "submission_unknown",
      operationId: null,
    });
    expect(c.fetcher).toHaveBeenCalledTimes(2);
    c.store.recoverRuns();
    expect(c.store.getRun("run").cloudExecutions![0].status).toBe(
      "submission_unknown",
    );
  } finally {
    await c.close();
  }
});
it("does not submit a command when files change during upload", async () => {
  const c = await fixture();
  try {
    c.fetcher.mockImplementationOnce(
      async (_url: string, options: RequestInit) => {
        const bytes = Buffer.from(options.body as Buffer);
        const { createHash } = await import("node:crypto");
        const changed = c.store.getRun("run");
        changed.drafts[0].content = "changed during upload";
        changed.commands![0].revision = commandRevision(changed);
        c.store.saveRun(changed);
        return new Response(
          JSON.stringify({
            uuid: image,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
          }),
          { status: 201 },
        );
      },
    );
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    const result = await c.manager.submit(review.token, true);
    expect(result.cloudExecutions![0].status).toBe("failed");
    expect(result.cloudExecutions![0].error).toContain(
      "no command was submitted",
    );
    expect(c.fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await c.close();
  }
});
it("invalidates reviewed images after a new search or credential change", async () => {
  const c = await fixture();
  try {
    const review = c.manager.review(
      "run",
      "command",
      image,
      "/usr/local/bin/node",
    );
    await c.manager.images("node");
    await expect(c.manager.submit(review.token, true)).rejects.toThrow("fresh");
    c.manager.configure({
      key: "other-fixture-token",
      projectId: "another-project",
    });
    expect(() =>
      c.manager.review("run", "command", image, "/usr/local/bin/node"),
    ).toThrow("current catalog");
    expect(c.fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await c.close();
  }
});
it("ignores an image response arriving after credentials change", async () => {
  const c = await fixture();
  try {
    let finish!: (response: Response) => void;
    c.fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = c.manager.images("node");
    c.manager.configure({
      key: "other-fixture-token",
      projectId: "another-project",
    });
    finish(
      new Response(
        JSON.stringify({ images: [{ uuid: image, tag: "node:22" }] }),
      ),
    );
    await expect(pending).rejects.toThrow("changed");
    expect(() =>
      c.manager.review("run", "command", image, "/usr/local/bin/node"),
    ).toThrow("current catalog");
  } finally {
    await c.close();
  }
});
