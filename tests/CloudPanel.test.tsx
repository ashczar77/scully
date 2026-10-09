import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CloudPanel } from "../src/renderer/CloudPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
const run = {
  id: "run",
  status: "complete",
  files: [],
  drafts: [{ path: "test.js", content: "console.log(1)" }],
  commands: [{ id: "command", executable: "node", decision: "pending" }],
  cloudExecutions: [],
} as unknown as Run;
function bridge() {
  return {
    cloudImages: vi.fn().mockResolvedValue({
      images: [{ uuid: "image-id", tag: "node:22" }],
      limited: false,
    }),
    resolveCloudExecutable: vi.fn().mockResolvedValue({
      path: "/usr/bin/node",
      reason: "Executable file verified in the selected image.",
    }),
    cloudSession: vi
      .fn()
      .mockResolvedValue({ configured: true, projectId: "project-fixture" }),
    reviewCloud: vi.fn().mockResolvedValue({
      token: "one-use",
      runId: "run",
      commandId: "command",
      revision: "revision",
      projectId: "project-fixture",
      image: "image-id",
      executable: "/usr/bin/node",
      executableVerified: true,
      args: ["test.js"],
      cwd: "/workspace",
      timeoutSeconds: 30,
      files: [{ path: "test.js", bytes: 14, sha256: "digest" }],
      expiresAt: "2026-10-10T00:00:00Z",
    }),
    submitCloud: vi.fn().mockResolvedValue(run),
    refreshCloud: vi.fn(),
  } as unknown as DesktopAPI;
}
it("shows exact files and command and requires a fresh cloud consent", async () => {
  const api = bridge();
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.change(
    screen.getByLabelText("Search sandbox image tags by prefix"),
    { target: { value: "node" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  const selected = await screen.findByRole("button", { name: /node:22/ });
  fireEvent.click(selected);
  expect(selected).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  await waitFor(() =>
    expect(api.resolveCloudExecutable).toHaveBeenCalledWith(
      "run",
      "command",
      "image-id",
      undefined,
    ),
  );
  await waitFor(() =>
    expect(api.reviewCloud).toHaveBeenCalledWith(
      "run",
      "command",
      "image-id",
      "/usr/bin/node",
      { saveChanges: false },
    ),
  );
  const submit = await screen.findByRole("button", {
    name: "Approve and run in cloud",
  });
  expect(submit).toBeDisabled();
  expect(screen.getAllByText(/project-fixture/)).toHaveLength(2);
  expect(screen.getByText(/"test.js"/)).toBeInTheDocument();
  expect(
    screen.getByText(/"executableVerifiedInImage": true/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve uploading/ }),
  );
  fireEvent.click(submit);
  await waitFor(() =>
    expect(api.submitCloud).toHaveBeenCalledWith("one-use", true),
  );
});
it("shows a proposed criterion before cloud approval without submitting", async () => {
  const api = bridge();
  const criterionRun = {
    ...run,
    commands: [
      {
        ...run.commands![0],
        revision: "revision",
        findingLink: {
          auditIndex: 0,
          findingIndex: 0,
          revision: "revision",
          path: "test.js",
          detail: "Check result",
          severity: "warning",
          expected: "Marker appears",
          criterion: { exitCode: 0, outputIncludes: "assertions: 4" },
        },
      },
    ],
  } as Run;
  render(<CloudPanel api={api} run={criterionRun} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  expect(
    await screen.findByText(/Proposed observation criterion/),
  ).toHaveTextContent("assertions: 4");
  expect(
    screen.getByRole("button", { name: "Approve and run in cloud" }),
  ).toBeDisabled();
  expect(api.submitCloud).not.toHaveBeenCalled();
});
it("clears a prior image choice when the search changes", async () => {
  const api = bridge();
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  expect(
    screen.getByRole("button", { name: /Review cloud check/ }),
  ).toBeEnabled();
  vi.mocked(api.cloudImages).mockResolvedValueOnce({
    images: [],
    limited: false,
  });
  fireEvent.change(
    screen.getByLabelText("Search sandbox image tags by prefix"),
    { target: { value: "python" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  await screen.findByText(
    "No tagged public images matched. Try another prefix.",
  );
  expect(
    screen.getByRole("button", { name: /Review cloud check/ }),
  ).toBeDisabled();
  expect(api.reviewCloud).not.toHaveBeenCalled();
});
it("asks for an unverified path only after inspection cannot find a match", async () => {
  const api = bridge();
  vi.mocked(api.resolveCloudExecutable).mockResolvedValueOnce({
    path: null,
    reason: "No executable verified.",
  });
  const review = await api.reviewCloud(
    "run",
    "command",
    "image-id",
    "/usr/bin/node",
  );
  vi.mocked(api.reviewCloud).mockClear();
  vi.mocked(api.reviewCloud).mockResolvedValueOnce({
    ...review,
    executableVerified: false,
  });
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  await screen.findByText("No executable verified.");
  expect(api.reviewCloud).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByLabelText("Executable inside image, unverified"),
    { target: { value: "/custom/node" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Review entered path" }));
  await waitFor(() =>
    expect(api.reviewCloud).toHaveBeenCalledWith(
      "run",
      "command",
      "image-id",
      "/custom/node",
      { saveChanges: false },
    ),
  );
  expect(
    await screen.findByText(/"executableVerifiedInImage": false/),
  ).toBeInTheDocument();
});
it("keeps saving optional and requires a new review when the choice changes", async () => {
  const api = bridge();
  const savingReview = await api.reviewCloud(
    "run",
    "command",
    "image-id",
    "/usr/bin/node",
  );
  vi.mocked(api.reviewCloud).mockClear();
  vi.mocked(api.reviewCloud).mockResolvedValueOnce({
    ...savingReview,
    saveChanges: true,
  });
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  const save = screen.getByRole("checkbox", {
    name: "Save this environment for another experiment",
  });
  expect(save).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(save);
  expect(
    screen.getByText(/does not yet provide remote deletion/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  await screen.findByText(/This approval includes saving/);
  expect(api.reviewCloud).toHaveBeenCalledWith(
    "run",
    "command",
    "image-id",
    "/usr/bin/node",
    { saveChanges: true },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve uploading/ }),
  );
  fireEvent.click(save);
  expect(
    screen.queryByRole("button", { name: "Approve and run in cloud" }),
  ).not.toBeInTheDocument();
  expect(api.submitCloud).not.toHaveBeenCalled();
});
it("lets a user branch from a saved result while keeping a failed check visible", async () => {
  const api = bridge();
  const original = await api.reviewCloud(
    "run",
    "command",
    "image-id",
    "/usr/bin/node",
  );
  vi.mocked(api.reviewCloud).mockClear();
  vi.mocked(api.reviewCloud).mockResolvedValueOnce({
    ...original,
    image: "saved-image",
    parentExecutionId: "parent",
    saveChanges: false,
  });
  const savedRun: Run = {
    ...run,
    commands: [{ ...run.commands![0], revision: "revision" }],
    cloudExecutions: [
      {
        ...original,
        id: "parent",
        status: "complete",
        operationId: "operation",
        remoteStatus: "SUCCESS",
        saveChanges: true,
        resultImage: "saved-image",
        commandPassed: false,
        exitCode: 1,
        stdout: "failed assertion",
        stderr: "",
        error: "",
        startedAt: "2026-10-09T10:00:00Z",
      },
    ],
  };
  render(<CloudPanel api={api} run={savedRun} />);
  const saved = await screen.findByRole("button", {
    name: /Saved environment from check 1/,
  });
  expect(saved).toHaveTextContent("Command did not pass");
  fireEvent.click(saved);
  expect(api.cloudImages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  const submit = await screen.findByRole("button", {
    name: "Approve and run in cloud",
  });
  expect(submit).toBeDisabled();
  expect(api.resolveCloudExecutable).toHaveBeenCalledWith(
    "run",
    "command",
    "saved-image",
    "parent",
  );
  expect(api.reviewCloud).toHaveBeenCalledWith(
    "run",
    "command",
    "saved-image",
    "/usr/bin/node",
    { saveChanges: false, parentExecutionId: "parent" },
  );
  expect(screen.getByText(/Saved files outside this list/)).toBeInTheDocument();
  expect(api.submitCloud).not.toHaveBeenCalled();
});
it("shows completed checks from the same starting image together in the run panel", async () => {
  const api = bridge();
  const completedRun = {
    ...run,
    commands: [
      {
        ...run.commands![0],
        revision: "revision",
        findingLink: {
          auditIndex: 0,
          findingIndex: 0,
          revision: "revision",
          path: "test.js",
          detail: "Check result",
          severity: "warning",
          expected: "Output after",
          criterion: { exitCode: 1, outputIncludes: "after" },
        },
      },
    ],
    cloudExecutions: [
      {
        id: "first",
        commandId: "command",
        projectId: "project-fixture",
        revision: "revision",
        image: "image-id",
        executable: "/usr/bin/node",
        status: "complete",
        operationId: "operation-first",
        remoteStatus: "SUCCESS",
        exitCode: 0,
        stdout: "before",
        stderr: "",
      },
      {
        id: "second",
        commandId: "command",
        projectId: "project-fixture",
        revision: "revision",
        image: "image-id",
        executable: "/usr/bin/node",
        status: "complete",
        operationId: "operation-second",
        remoteStatus: "SUCCESS",
        exitCode: 1,
        timedOut: false,
        signal: null,
        stdout: "after",
        stderr: "",
        outputTruncated: false,
      },
    ],
  } as Run;
  render(<CloudPanel api={api} run={completedRun} />);
  expect(
    screen.getByRole("region", { name: "Experiment comparison" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Check 2 captured stdout")).toHaveTextContent(
    "after",
  );
  expect(screen.getAllByText(/Proposed criterion met/).length).toBeGreaterThan(
    0,
  );
  expect(api.refreshCloud).not.toHaveBeenCalled();
  expect(api.submitCloud).not.toHaveBeenCalled();
});
it("polls only a confirmed approved operation and stops after completion", async () => {
  const api = bridge();
  const submitted = {
    ...run,
    cloudExecutions: [
      {
        id: "execution",
        commandId: "command",
        projectId: "project-fixture",
        status: "submitted",
        operationId: "operation",
      },
    ],
  } as Run;
  const complete = {
    ...run,
    cloudExecutions: [{ ...submitted.cloudExecutions![0], status: "complete" }],
  } as Run;
  vi.mocked(api.submitCloud).mockResolvedValueOnce(submitted);
  vi.mocked(api.refreshCloud).mockResolvedValueOnce(complete);
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  const submit = await screen.findByRole("button", {
    name: "Approve and run in cloud",
  });
  vi.useFakeTimers();
  try {
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I approve uploading/ }),
    );
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    expect(api.submitCloud).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Checking remote status automatically/),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(api.refreshCloud).toHaveBeenCalledWith("run", "execution");
    expect(api.refreshCloud).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.refreshCloud).toHaveBeenCalledTimes(1);
    expect(api.submitCloud).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("caps read-only status checks without resubmitting the command", async () => {
  const api = bridge();
  const submitted = {
    ...run,
    cloudExecutions: [
      {
        id: "execution",
        commandId: "command",
        projectId: "project-fixture",
        status: "submitted",
        operationId: "operation",
      },
    ],
  } as Run;
  vi.mocked(api.submitCloud).mockResolvedValueOnce(submitted);
  vi.mocked(api.refreshCloud).mockResolvedValue(submitted);
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  const submit = await screen.findByRole("button", {
    name: "Approve and run in cloud",
  });
  vi.useFakeTimers();
  try {
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I approve uploading/ }),
    );
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    for (let index = 0; index < 12; index++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
    expect(api.refreshCloud).toHaveBeenCalledTimes(12);
    expect(screen.getByText(/reached their limit/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.refreshCloud).toHaveBeenCalledTimes(12);
    expect(api.submitCloud).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("ignores a late status response after cloud credentials are changed", async () => {
  const api = bridge();
  const submitted = {
    ...run,
    cloudExecutions: [
      {
        id: "execution",
        commandId: "command",
        projectId: "project-fixture",
        status: "submitted",
        operationId: "operation",
      },
    ],
  } as Run;
  vi.mocked(api.submitCloud).mockResolvedValueOnce(submitted);
  let finishRefresh!: (value: Run) => void;
  vi.mocked(api.refreshCloud).mockReturnValueOnce(
    new Promise<Run>((resolve) => {
      finishRefresh = resolve;
    }),
  );
  render(<CloudPanel api={api} run={run} />);
  await screen.findByText("Cloud project: project-fixture");
  fireEvent.click(screen.getByRole("button", { name: "Find sandbox images" }));
  fireEvent.click(await screen.findByRole("button", { name: /node:22/ }));
  fireEvent.click(screen.getByRole("button", { name: /Review cloud check/ }));
  const submit = await screen.findByRole("button", {
    name: "Approve and run in cloud",
  });
  vi.useFakeTimers();
  try {
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I approve uploading/ }),
    );
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(api.refreshCloud).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Change cloud credentials" }),
    );
    await act(async () => {
      finishRefresh(submitted);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.refreshCloud).toHaveBeenCalledTimes(1);
    expect(api.submitCloud).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
