import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LineupProposalPanel } from "../src/renderer/LineupProposalPanel";
import {
  catalogTeammate,
  rosterMembers,
  starterRoster,
} from "../src/shared/fixed-teams";

it("shows task reasons and whether a suggested specialist belongs to the saved team", () => {
  render(
    <LineupProposalPanel
      proposal={{
        planRevision: "revision",
        discardedInvalid: false,
        suggestions: [
          { id: "sloane", phase: "planning", reason: "Map the first-run flow" },
          {
            id: "kiran",
            phase: "verification",
            reason: "Review account recovery boundaries",
          },
        ],
      }}
      team={[...rosterMembers(starterRoster), catalogTeammate("sloane")]}
    />,
  );
  const panel = screen.getByRole("region", { name: "Suggested specialists" });
  const [sloane, kiran] = within(panel).getAllByRole("listitem");
  expect(sloane).toHaveTextContent("On saved team");
  expect(sloane).toHaveTextContent("Map the first-run flow");
  expect(kiran).toHaveTextContent("Outside saved team");
  expect(kiran).toHaveTextContent("verification");
  expect(panel).toHaveTextContent("No specialist is dispatched");
  expect(panel).toHaveTextContent("separate scope, cost and permission review");
});

it("shows an empty recommendation and an invalid-output warning without dispatch controls", () => {
  render(
    <LineupProposalPanel
      proposal={{
        planRevision: "revision",
        discardedInvalid: true,
        suggestions: [],
      }}
      team={rosterMembers(starterRoster)}
    />,
  );
  expect(
    screen.getByText(/No additional specialist recommended/),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("discarded");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("renders an untrusted suggestion reason as text", () => {
  const { container } = render(
    <LineupProposalPanel
      proposal={{
        planRevision: "revision",
        discardedInvalid: false,
        suggestions: [
          {
            id: "kiran",
            phase: "verification",
            reason: "<img src=x onerror=alert(1)>",
          },
        ],
      }}
      team={rosterMembers(starterRoster)}
    />,
  );
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});

it("lets the user replace a suggestion, choose its phase and purpose, or approve none", () => {
  const onApprove = vi.fn();
  const proposal = {
    planRevision: "revision",
    discardedInvalid: false,
    suggestions: [
      {
        id: "kiran" as const,
        phase: "verification" as const,
        reason: "Review auth",
      },
    ],
  };
  const { rerender } = render(
    <LineupProposalPanel
      proposal={proposal}
      team={rosterMembers(starterRoster)}
      onApprove={onApprove}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Approve no specialists" }),
  );
  expect(onApprove).toHaveBeenCalledWith([]);
  fireEvent.click(screen.getByText("Add a specialist"));
  fireEvent.click(screen.getByRole("button", { name: /Sloane/ }));
  const panel = screen.getByRole("region", { name: "Suggested specialists" });
  expect(
    within(panel).getByRole("button", { name: "Approve specialist selection" }),
  ).toBeDisabled();
  fireEvent.click(within(panel).getByRole("button", { name: "planning" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: /Purpose for Sloane/ }),
    { target: { value: "Map the first-run journey" } },
  );
  fireEvent.click(
    within(panel).getByRole("button", { name: "Approve specialist selection" }),
  );
  expect(onApprove).toHaveBeenLastCalledWith([
    { id: "sloane", phase: "planning", purpose: "Map the first-run journey" },
  ]);
  rerender(
    <LineupProposalPanel
      proposal={proposal}
      team={rosterMembers(starterRoster)}
      approvedLineup={{
        planRevision: "revision",
        entries: [
          {
            id: "sloane",
            phase: "planning",
            purpose: "Map the first-run journey",
          },
        ],
        approvedAt: "now",
      }}
      onApprove={onApprove}
    />,
  );
  expect(screen.getByText("Approved selection")).toBeInTheDocument();
});
