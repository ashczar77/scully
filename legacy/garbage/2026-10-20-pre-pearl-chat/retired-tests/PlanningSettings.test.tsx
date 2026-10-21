import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PlanningSettings } from "../src/renderer/PlanningSettings";
import type { DesktopAPI } from "../src/shared/contracts";

it("loads and saves a planning temperature separately from credentials", async () => {
  const planningSettings = vi.fn().mockResolvedValue({ temperature: 0.2 });
  const setPlanningSettings = vi.fn().mockResolvedValue({ temperature: 0.4 });
  render(
    <PlanningSettings
      api={{ planningSettings, setPlanningSettings } as unknown as DesktopAPI}
    />,
  );
  const slider = await screen.findByLabelText("Planning temperature: 0.2");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.change(slider, { target: { value: "0.4" } });
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save planning temperature" }),
    );
    await Promise.resolve();
  });
  expect(setPlanningSettings).toHaveBeenCalledWith({ temperature: 0.4 });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Planning temperature saved.",
  );
  act(() => vi.advanceTimersByTime(3500));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  vi.useRealTimers();
});
