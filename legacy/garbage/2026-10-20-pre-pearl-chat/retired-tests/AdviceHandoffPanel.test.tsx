import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AdviceHandoffPanel } from "../src/renderer/AdviceHandoffPanel";
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
  consultations: [
    {
      id: "consult",
      specialistId: "sloane",
      phase: "planning",
      purpose: "Check the first-run flow",
      planRevision: "revision",
      contextRevision: "context",
      status: "answered",
      advice: "<script>show a clear error</script>",
      questions: ["Which users need access?"],
      at: "now",
    },
  ],
};

it("requires a separate consent before attaching exact advice as text", async () => {
  const handoff = JSON.stringify({
    specialistId: "sloane",
    purpose: "Check the first-run flow",
    advice: "<script>show a clear error</script>",
    questions: ["Which users need access?"],
    questionDecisions: [
      { question: "Which users need access?", answer: "New users." },
    ],
  });
  const reviewAdvice = vi.fn().mockResolvedValue({
    token: "ticket",
    runId: "run",
    consultationId: "consult",
    planRevision: "revision",
    adviceRevision: "advice-revision",
    handoffRevision: "handoff-revision",
    answers: ["New users."],
    handoff,
    inputBytes: 163,
    writerRequests: 2,
    expiresAt: Date.now() + 1000,
  });
  const approveAdvice = vi
    .fn()
    .mockResolvedValue({ ...planned, approvedAdvice: [] });
  const api = { reviewAdvice, approveAdvice } as unknown as DesktopAPI;
  const onUpdated = vi.fn();
  render(<AdviceHandoffPanel api={api} run={planned} onUpdated={onUpdated} />);
  expect(approveAdvice).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "Your answer to: Which users need access?",
    }),
    {
      target: { value: "New users." },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review builder handoff" }),
  );
  await waitFor(() =>
    expect(reviewAdvice).toHaveBeenCalledWith("run", "consult", ["New users."]),
  );
  expect(await screen.findByText(handoff)).toBeInTheDocument();
  expect(
    screen.getByText(/Extra input tokens and cost are unknown/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Attach advice" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I approve sharing this advice/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Attach advice" }));
  await waitFor(() =>
    expect(approveAdvice).toHaveBeenCalledWith("ticket", true),
  );
  expect(onUpdated).toHaveBeenCalledOnce();
});

it("can remove attached advice without requesting another consultation", async () => {
  const removeAdvice = vi
    .fn()
    .mockResolvedValue({ ...planned, approvedAdvice: [] });
  const api = { removeAdvice } as unknown as DesktopAPI;
  render(
    <AdviceHandoffPanel
      api={api}
      run={{
        ...planned,
        approvedAdvice: [
          {
            consultationId: "consult",
            specialistId: "sloane",
            planRevision: "revision",
            adviceRevision: "advice-revision",
            approvedAt: "now",
          },
        ],
      }}
      onUpdated={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove from build" }));
  await waitFor(() =>
    expect(removeAdvice).toHaveBeenCalledWith("run", "consult"),
  );
});

it("clears approval review when the user changes an answer", async () => {
  const reviewAdvice = vi.fn().mockResolvedValue({
    token: "ticket",
    runId: "run",
    consultationId: "consult",
    planRevision: "revision",
    adviceRevision: "advice-revision",
    handoffRevision: "handoff-revision",
    answers: [""],
    handoff: "Exact answer preview",
    inputBytes: 20,
    writerRequests: 2,
    expiresAt: Date.now() + 1000,
  });
  const api = { reviewAdvice } as unknown as DesktopAPI;
  render(<AdviceHandoffPanel api={api} run={planned} onUpdated={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Review builder handoff" }),
  );
  expect(await screen.findByText("Exact answer preview")).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "Your answer to: Which users need access?",
    }),
    {
      target: { value: "Returning users." },
    },
  );
  expect(
    screen.queryByRole("button", { name: "Attach advice" }),
  ).not.toBeInTheDocument();
});

it("offers answered pre-build advice for a separate builder handoff", () => {
  const api = { reviewAdvice: vi.fn() } as unknown as DesktopAPI;
  render(
    <AdviceHandoffPanel
      api={api}
      run={{
        ...planned,
        approvedLineup: {
          ...planned.approvedLineup!,
          entries: [
            { id: "rafi", phase: "building", purpose: "Check architecture" },
          ],
        },
        consultations: [
          {
            ...planned.consultations![0],
            specialistId: "rafi",
            phase: "building",
            purpose: "Check architecture",
          },
        ],
      }}
      onUpdated={vi.fn()}
    />,
  );
  expect(screen.getByText("Pre-build briefing")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review builder handoff" }),
  ).toBeInTheDocument();
});
