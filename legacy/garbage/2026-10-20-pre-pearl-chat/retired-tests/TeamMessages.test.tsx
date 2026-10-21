import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeamMessages } from "../src/renderer/TeamMessages";
import type { Run, RunAPI } from "../src/shared/runs";

const base = { id: "r", status: "planning", messages: [] } as unknown as Run;
function api(overrides: Partial<RunAPI> = {}): RunAPI {
  return {
    messageRoutingSettings: vi.fn().mockResolvedValue({ unclear: "pearl" }),
    sendTeamMessage: vi.fn().mockResolvedValue({
      ...base,
      messages: [{ id: "m", text: "Check the layout", intent: "continue" }],
    }),
    reviewRoutedReply: vi.fn().mockResolvedValue({
      routing: {
        recipientId: "sloane",
        reason: "Sloane matches the subject.",
        needsChoice: false,
      },
      review: {
        token: "ticket",
        runId: "r",
        messageId: "m",
        context: "snapshot",
        model: "model",
        outputTokens: 1024,
        recipient: { id: "sloane", name: "Sloane", role: "UI and UX design" },
      },
    }),
    answerMessage: vi.fn().mockResolvedValue(base),
    ...overrides,
  } as unknown as RunAPI;
}

it("offers one message composer after planning starts, without recipient or intent radios", () => {
  render(<TeamMessages run={base} api={api()} />);
  expect(screen.getByText("Ask your team")).toBeInTheDocument();
  expect(screen.getByLabelText("Your message")).toBeInTheDocument();
  expect(
    screen.queryByText("Who should answer your saved question?"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      /Continue current work unchanged; save this note locally/,
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Change in Settings")).toBeInTheDocument();
});

it("does not offer a question or change of direction before planning starts", () => {
  render(<TeamMessages run={{ ...base, status: "prepared" }} api={api()} />);
  expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Change the task direction"),
  ).not.toBeInTheDocument();
});

it("shows the suggested teammate locally when no session is configured", async () => {
  const client = api({
    reviewRoutedReply: vi.fn().mockResolvedValue({
      routing: {
        recipientId: "sloane",
        reason: "You tagged Sloane.",
        needsChoice: false,
      },
      needsConnection: true,
      review: null,
    }),
  });
  render(
    <TeamMessages
      run={{
        ...base,
        messages: [
          { id: "m", text: "@Sloane help", intent: "continue", at: "now" },
        ],
      }}
      api={client}
    />,
  );
  fireEvent.click(screen.getByText("Review answer"));
  await screen.findByText(/Configure a Nebius session/);
  expect(screen.getByRole("status")).toHaveTextContent("You tagged Sloane");
  expect(client.answerMessage).not.toHaveBeenCalled();
});

it("saves locally, routes to a subject expert, and waits for a separate upload approval", async () => {
  const client = api();
  render(<TeamMessages run={base} api={client} />);
  fireEvent.change(screen.getByLabelText("Your message"), {
    target: { value: "Check the layout" },
  });
  fireEvent.click(screen.getByText("Send message"));
  await screen.findByText(
    (_, element) =>
      element?.tagName === "P" &&
      !!element.textContent?.includes("Sloane will answer"),
  );
  expect(client.sendTeamMessage).toHaveBeenCalledWith("r", {
    text: "Check the layout",
    intent: "continue",
  });
  expect(client.reviewRoutedReply).toHaveBeenCalledWith("r", "m");
  expect(client.answerMessage).not.toHaveBeenCalled();
  expect(screen.getByText("Request answer")).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("Approve this upload and one model request"),
  );
  fireEvent.click(screen.getByText("Request answer"));
  await waitFor(() =>
    expect(client.answerMessage).toHaveBeenCalledWith("ticket", true),
  );
});

it("asks for a teammate only when routing is unclear and configured to ask", async () => {
  const client = api({
    messageRoutingSettings: vi.fn().mockResolvedValue({ unclear: "ask" }),
    reviewRoutedReply: vi.fn().mockResolvedValue({
      routing: { reason: "Choose a teammate.", needsChoice: true },
      review: null,
    }),
    reviewReply: vi.fn().mockResolvedValue({
      token: "chosen",
      runId: "r",
      messageId: "m",
      context: "snapshot",
      model: "model",
      outputTokens: 1024,
      recipient: { id: "ellis", name: "Ellis", role: "Code auditor" },
    }),
  });
  render(
    <TeamMessages
      run={{
        ...base,
        messages: [{ id: "m", text: "Help?", intent: "continue", at: "now" }],
      }}
      api={client}
    />,
  );
  fireEvent.click(screen.getByText("Review answer"));
  await screen.findByText("Who should answer?");
  fireEvent.click(screen.getByText("Ellis · Code auditor"));
  await screen.findByText(
    (_, element) =>
      element?.tagName === "P" &&
      !!element.textContent?.includes("Ellis will answer"),
  );
  expect(client.reviewReply).toHaveBeenCalledWith("r", "m", "ellis");
});

it("keeps the change direction action separate from asking a question", async () => {
  const sendTeamMessage = vi.fn().mockResolvedValue(base);
  const client = api({
    sendTeamMessage,
    requestRunPause: vi.fn().mockResolvedValue(base),
  });
  render(<TeamMessages run={{ ...base, status: "building" }} api={client} />);
  fireEvent.click(screen.getByText("Pause before next request"));
  await waitFor(() => expect(client.requestRunPause).toHaveBeenCalledWith("r"));
  expect(sendTeamMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Change the task direction"));
  fireEvent.change(screen.getByLabelText("New direction"), {
    target: { value: "Use a different plan" },
  });
  fireEvent.click(screen.getByText("Prepare revised plan"));
  await waitFor(() =>
    expect(sendTeamMessage).toHaveBeenCalledWith("r", {
      text: "Use a different plan",
      intent: "replan",
    }),
  );
});

it("shows saved answers and stops only an active reply", async () => {
  const stopReply = vi.fn().mockResolvedValue(base);
  render(
    <TeamMessages
      run={{
        ...base,
        status: "building",
        messages: [{ id: "m", text: "Why?", intent: "continue", at: "now" }],
        replies: [
          {
            id: "q",
            messageId: "m",
            revision: "hash",
            status: "answering",
            answer: "",
            at: "now",
          },
        ],
      }}
      api={api({ stopReply })}
    />,
  );
  fireEvent.click(screen.getByText("Stop reply"));
  await waitFor(() => expect(stopReply).toHaveBeenCalledWith("r"));
});
