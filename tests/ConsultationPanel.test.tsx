import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConsultationPanel } from "../src/renderer/ConsultationPanel";
import type { DesktopAPI } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

const planned: Run = {
  id: "run",
  taskId: "task",
  sourceName: "New project",
  files: [],
  status: "planned",
  events: [],
  plan: "Sketch checkout",
  drafts: [],
  findings: [],
  checks: [],
  error: "",
  calls: 1,
  model: "",
  outputTokens: 0,
  lineupProposal: {
    planRevision: "revision",
    suggestions: [],
    discardedInvalid: false,
  },
  approvedLineup: {
    planRevision: "revision",
    approvedAt: "now",
    entries: [
      { id: "sloane", phase: "planning", purpose: "Check the first-run flow" },
    ],
  },
};

it("shows a separate pre-build specialist request before writers start", async () => {
  const reviewConsultation = vi.fn().mockResolvedValue({
    token: "building-ticket",
    runId: "run",
    specialistId: "rafi",
    phase: "building",
    context: '{"plan":"Sketch checkout"}',
    contextRevision: "context",
    planRevision: "revision",
    expiresAt: Date.now() + 1000,
    model: "fixture-model",
    outputTokens: 1024,
    projectedNanoUsd: null,
    rateStatus: "unknown",
  });
  const api = { reviewConsultation } as unknown as DesktopAPI;
  render(
    <ConsultationPanel
      api={api}
      run={{
        ...planned,
        approvedLineup: {
          ...planned.approvedLineup!,
          entries: [
            { id: "rafi", phase: "building", purpose: "Check architecture" },
          ],
        },
      }}
      phase="building"
      onUpdated={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Pre-build consultations" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/does not include source files or interrupt active work/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review consultation" }));
  expect(
    await screen.findByText('{"plan":"Sketch checkout"}'),
  ).toBeInTheDocument();
  expect(reviewConsultation).toHaveBeenCalledWith("run", "rafi");
});

it("shows the exact upload and requires a fresh checkbox before one request", async () => {
  const reviewConsultation = vi.fn().mockResolvedValue({
    token: "ticket",
    runId: "run",
    specialistId: "sloane",
    context: '{"task":"Checkout","plan":"Sketch checkout"}',
    contextRevision: "context",
    planRevision: "revision",
    expiresAt: Date.now() + 1000,
    model: "fixture-model",
    outputTokens: 1024,
    projectedNanoUsd: null,
    rateStatus: "unknown",
  });
  const startConsultation = vi
    .fn()
    .mockResolvedValue({ ...planned, consultations: [] });
  const api = {
    reviewConsultation,
    startConsultation,
  } as unknown as DesktopAPI;
  render(<ConsultationPanel api={api} run={planned} onUpdated={vi.fn()} />);
  expect(startConsultation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review consultation" }));
  expect(await screen.findByText(/Sketch checkout"}/)).toBeInTheDocument();
  expect(
    screen.getByText(/Model cost estimate unavailable/),
  ).toBeInTheDocument();
  const request = screen.getByRole("button", { name: "Request consultation" });
  expect(request).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve this exact upload/ }),
  );
  expect(request).toBeEnabled();
  fireEvent.click(request);
  await waitFor(() =>
    expect(startConsultation).toHaveBeenCalledWith("ticket", true),
  );
});

it("renders model advice as text and offers no second request for the same specialist", () => {
  const api = { reviewConsultation: vi.fn() } as unknown as DesktopAPI;
  render(
    <ConsultationPanel
      api={api}
      run={{
        ...planned,
        consultations: [
          {
            id: "consult",
            specialistId: "sloane",
            phase: "planning",
            purpose: "Check the first-run flow",
            planRevision: "revision",
            contextRevision: "context",
            status: "answered",
            advice: "<script>not code</script>",
            questions: ["Which users need access?"],
            at: "now",
          },
        ],
      }}
      onUpdated={vi.fn()}
    />,
  );
  expect(screen.getByText("<script>not code</script>")).toBeInTheDocument();
  expect(screen.getByText("Which users need access?")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Review consultation" }),
  ).not.toBeInTheDocument();
});

it("shows a separate completed-draft review for a verification assignment", async () => {
  const reviewConsultation = vi.fn().mockResolvedValue({
    token: "verification-ticket",
    runId: "run",
    specialistId: "kiran",
    phase: "verification",
    context: '{"drafts":[{"path":"app.ts","content":"draft content"}]}',
    contextRevision: "context",
    planRevision: "revision",
    artifactRevision: "abcdef1234567890",
    expiresAt: Date.now() + 1000,
    model: "fixture-model",
    outputTokens: 1024,
    projectedNanoUsd: null,
    rateStatus: "unknown",
  });
  const api = { reviewConsultation } as unknown as DesktopAPI;
  render(
    <ConsultationPanel
      api={api}
      run={{
        ...planned,
        status: "complete",
        approvedLineup: {
          ...planned.approvedLineup!,
          entries: [
            {
              id: "kiran",
              phase: "verification",
              purpose: "Review authentication",
            },
          ],
        },
      }}
      onUpdated={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Draft verification consultations" }),
  ).toHaveTextContent("Review authentication");
  fireEvent.click(screen.getByRole("button", { name: "Review consultation" }));
  expect(await screen.findByText(/abcdef123456/)).toBeInTheDocument();
  expect(screen.getByText(/draft content/)).toBeInTheDocument();
  expect(reviewConsultation).toHaveBeenCalledWith("run", "kiran");
  expect(
    screen.getByRole("button", { name: "Request consultation" }),
  ).toBeDisabled();
});
