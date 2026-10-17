import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LineupProposalPanel } from "../src/renderer/LineupProposalPanel";
import {
  catalogTeammate,
  rosterMembers,
  starterRoster,
} from "../src/shared/fixed-teams";

it("lets the user approve Pearl's work roles or choose saved alternatives without cost clutter", () => {
  const onApprove = vi.fn();
  render(
    <LineupProposalPanel
      proposal={{
        planRevision: "revision",
        discardedInvalid: false,
        suggestions: [],
        core: {
          builderId: "maya",
          auditorId: "ellis",
          testerId: "jun",
          reason:
            "Maya and Jun can work in parallel on implementation and tests.",
          fallback: false,
        },
      }}
      team={rosterMembers({
        ...starterRoster,
        memberIds: [...starterRoster.memberIds, "adrian", "meryl"],
      })}
      onApprove={onApprove}
    />,
  );
  const panel = screen.getByRole("region", { name: "Team lineup" });
  expect(panel).toHaveTextContent("Does this lineup look right?");
  expect(panel).not.toHaveTextContent("Core run:");
  fireEvent.click(within(panel).getByRole("button", { name: "Adrian" }));
  fireEvent.click(within(panel).getByRole("button", { name: "Meryl" }));
  fireEvent.click(within(panel).getByRole("button", { name: "No tester" }));
  expect(panel).not.toHaveTextContent("Core run:");
  fireEvent.click(
    within(panel).getByRole("button", { name: "Approve team for this plan" }),
  );
  expect(onApprove).toHaveBeenCalledWith([], {
    builderId: "adrian",
    auditorId: "meryl",
    testerId: null,
  });
});

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
  expect(panel).not.toHaveTextContent("permission review");
});

it("shows an empty recommendation without internal validation noise", () => {
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
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
