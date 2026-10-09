import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeamMessages } from "../src/renderer/TeamMessages";
import type { Run, RunAPI } from "../src/shared/runs";
it("offers questions during work and stops only the reply", async () => {
  const stopReply = vi.fn().mockResolvedValue({});
  const stopRun = vi.fn();
  const run = {
    id: "r",
    status: "building",
    messages: [{ id: "m", text: "Why?", intent: "continue" }],
  } as Run;
  const api = { stopReply, stopRun } as unknown as RunAPI;
  const { rerender } = render(<TeamMessages run={run} api={api} />);
  expect(screen.getByText("Review reply upload")).toBeEnabled();
  rerender(
    <TeamMessages
      run={{
        ...run,
        replies: [
          {
            id: "q",
            messageId: "m",
            revision: "hash",
            status: "answering",
            answer: "",
            at: "now",
            duringWork: true,
          },
        ],
      }}
      api={api}
    />,
  );
  expect(screen.getByText("Review reply upload")).toBeDisabled();
  fireEvent.click(screen.getByText("Stop reply"));
  await waitFor(() => expect(stopReply).toHaveBeenCalledWith("r"));
  expect(stopRun).not.toHaveBeenCalled();
});
it("does not upload until the exact reply snapshot is approved", async () => {
  const reviewReply = vi.fn().mockResolvedValue({
    token: "ticket",
    runId: "r",
    context: "exact snapshot",
    model: "fixture",
    outputTokens: 1024,
  });
  const answerMessage = vi.fn().mockResolvedValue({});
  render(
    <TeamMessages
      api={{ reviewReply, answerMessage } as unknown as RunAPI}
      run={
        {
          id: "r",
          status: "prepared",
          messages: [{ id: "m", text: "Why?", intent: "continue" }],
        } as Run
      }
    />,
  );
  fireEvent.click(screen.getByText("Review reply upload"));
  await screen.findByText("exact snapshot");
  expect(reviewReply).toHaveBeenCalledWith("r", "m", undefined);
  expect(answerMessage).not.toHaveBeenCalled();
  expect(screen.getByText("Request read-only reply")).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("Approve uploading this snapshot for one reply"),
  );
  fireEvent.click(screen.getByText("Request read-only reply"));
  await waitFor(() =>
    expect(answerMessage).toHaveBeenCalledWith("ticket", true),
  );
});
it("changing the recipient clears earlier consent and requests the selected teammate", async () => {
  const reviewReply = vi.fn().mockResolvedValue({
    token: "ticket",
    runId: "r",
    context: "profile snapshot",
    model: "fixture",
    outputTokens: 1024,
    recipient: { id: "ellis", name: "Ellis", role: "Code auditor" },
  });
  const answerMessage = vi.fn();
  render(
    <TeamMessages
      api={{ reviewReply, answerMessage } as unknown as RunAPI}
      run={
        {
          id: "r",
          status: "prepared",
          messages: [{ id: "m", text: "Why?", intent: "continue" }],
        } as Run
      }
    />,
  );
  fireEvent.click(screen.getByLabelText("Ellis · Code auditor"));
  fireEvent.click(screen.getByText("Review reply upload"));
  await screen.findByText("Reply from: Ellis · Code auditor");
  expect(reviewReply).toHaveBeenCalledWith("r", "m", "ellis");
  fireEvent.click(
    screen.getByLabelText("Approve uploading this snapshot for one reply"),
  );
  fireEvent.click(screen.getByLabelText("Jun · Test engineer"));
  expect(screen.queryByText("Request read-only reply")).not.toBeInTheDocument();
  expect(answerMessage).not.toHaveBeenCalled();
});
it("distinguishes local notes from explicit redirection without claiming an answer", async () => {
  const sendTeamMessage = vi.fn().mockResolvedValue({});
  render(
    <TeamMessages
      api={{ sendTeamMessage } as unknown as RunAPI}
      run={{ id: "r" } as Run}
    />,
  );
  expect(
    screen.getByText(/Notes are recorded, not answered/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Team message"), {
    target: { value: "Change direction" },
  });
  fireEvent.click(
    screen.getByLabelText("Stop local coordination and prepare a revised plan"),
  );
  expect(
    screen.getByText(/Remote requests may still finish/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Prepare revised plan"));
  await waitFor(() =>
    expect(sendTeamMessage).toHaveBeenCalledWith("r", {
      text: "Change direction",
      intent: "replan",
    }),
  );
});
