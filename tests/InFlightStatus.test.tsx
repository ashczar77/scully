import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { InFlightStatus } from "../src/renderer/InFlightStatus";
import { initialTeam } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

const run = {
  status: "building",
  inFlightRequests: [
    {
      id: "request-1",
      actor: "maya",
      name: "propose_files",
      startedAt: new Date(Date.now() - 3000).toISOString(),
    },
  ],
} as Run;

it("shows a real request in progress and hides it after the run stops", () => {
  const view = render(<InFlightStatus run={run} team={initialTeam} />);
  expect(
    screen.getByRole("region", { name: "Live request progress" }),
  ).toHaveTextContent("Maya: drafting changes");
  expect(
    screen.getByText(/response content appears only after/),
  ).toBeInTheDocument();
  view.rerender(
    <InFlightStatus run={{ ...run, status: "stopped" }} team={initialTeam} />,
  );
  expect(
    screen.queryByRole("region", { name: "Live request progress" }),
  ).toBeNull();
});
