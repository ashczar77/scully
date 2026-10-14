import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { TeamPreview } from "../src/renderer/TeamPreview";
import {
  catalogTeammate,
  rosterMembers,
  starterRoster,
} from "../src/shared/fixed-teams";

const session = {
  configured: true,
  model: "zai-org/GLM-5.3",
  outputTokens: 2048,
};

it("shows the active people and one required request for each current phase", () => {
  render(
    <TeamPreview
      team={rosterMembers(starterRoster)}
      mode="plan"
      session={session}
    />,
  );
  const lineup = screen.getByRole("list", {
    name: "Current automatic lineup",
  });
  const phases = within(lineup).getAllByRole("listitem");
  expect(phases).toHaveLength(4);
  for (const [index, member] of ["Pearl", "Maya", "Jun", "Ellis"].entries()) {
    expect(phases[index]).toHaveTextContent(member);
    expect(phases[index]).toHaveTextContent("1 request");
  }
  expect(screen.getByText(/4 required model requests/)).toBeInTheDocument();
});

it("shows reserve specialists as available without assigning a request", () => {
  const team = [...rosterMembers(starterRoster), catalogTeammate("sloane")];
  render(<TeamPreview team={team} mode="work" session={session} />);
  const lineup = screen.getByRole("list", {
    name: "Current automatic lineup",
  });
  expect(within(lineup).getAllByRole("listitem")).toHaveLength(3);
  expect(within(lineup).queryByText("Pearl")).not.toBeInTheDocument();
  expect(screen.getByText(/Sloane is on the team/)).toHaveTextContent(
    "no automatic work or model requests",
  );
  expect(
    screen.getByText(/later approved lineup or consultation/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Consider removing unused members/),
  ).not.toBeInTheDocument();
});
