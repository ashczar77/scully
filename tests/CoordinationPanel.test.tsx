import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CoordinationPanel } from "../src/renderer/CoordinationPanel";
import { makeCoordination } from "../src/shared/coordination";
import { initialTeam } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";
import type { DesktopAPI } from "../src/shared/contracts";
it("saves optional settings, discloses request increase and clears prior consent", async () => {
  const configureCoordination = vi.fn().mockResolvedValue({});
  const invalidate = vi.fn();
  render(
    <CoordinationPanel
      run={
        {
          id: "run",
          status: "prepared",
          coordination: makeCoordination(),
        } as Run
      }
      team={initialTeam}
      api={{ configureCoordination } as unknown as DesktopAPI}
      invalidateConsent={invalidate}
    />,
  );
  fireEvent.change(screen.getByLabelText("Ownership overrides"), {
    target: { value: "jun checks/" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByText(/Early reviews add up to 2 additional requests/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Save coordination settings" }),
  );
  await waitFor(() =>
    expect(configureCoordination).toHaveBeenCalledWith("run", {
      ownership: "jun checks/",
      chunkReviews: true,
    }),
  );
  expect(invalidate).toHaveBeenCalled();
});
it("shows owners and conflict evidence, without inventing a successful merge", () => {
  const c = makeCoordination();
  c.conflicts = [{ path: "math.js", detail: "Overlapping writers" }];
  render(
    <CoordinationPanel run={{ coordination: c } as Run} team={initialTeam} />,
  );
  expect(screen.getByText(/Maya owns integration/)).toBeInTheDocument();
  expect(screen.getByText(/Jun · waiting/)).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Overlapping writers");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "will not automatically retry",
  );
});
