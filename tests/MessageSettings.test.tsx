import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageSettings } from "../src/renderer/MessageSettings";
import type { DesktopAPI } from "../src/shared/contracts";

it("loads and saves the unclear-question preference without sending a model request", async () => {
  const messageRoutingSettings = vi.fn().mockResolvedValue({
    unclear: "pearl",
    specialistConsultation: "automatic",
  });
  const setMessageRoutingSettings = vi
    .fn()
    .mockResolvedValue({ unclear: "ask", specialistConsultation: "automatic" });
  const api = {
    messageRoutingSettings,
    setMessageRoutingSettings,
  } as unknown as DesktopAPI;
  render(<MessageSettings api={api} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Ask Pearl/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Let me choose/ }));
  await waitFor(() =>
    expect(setMessageRoutingSettings).toHaveBeenCalledWith({
      unclear: "ask",
      specialistConsultation: "automatic",
    }),
  );
  expect(screen.getByRole("button", { name: /Let me choose/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("lets the user require a Room conversation before specialist input", async () => {
  const setMessageRoutingSettings = vi.fn().mockResolvedValue({
    unclear: "pearl",
    specialistConsultation: "ask",
  });
  const api = {
    messageRoutingSettings: vi.fn().mockResolvedValue({
      unclear: "pearl",
      specialistConsultation: "automatic",
    }),
    setMessageRoutingSettings,
  } as unknown as DesktopAPI;
  render(<MessageSettings api={api} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Let Pearl consult/ }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  fireEvent.click(screen.getByRole("button", { name: /Ask me first/ }));
  await waitFor(() =>
    expect(setMessageRoutingSettings).toHaveBeenCalledWith({
      unclear: "pearl",
      specialistConsultation: "ask",
    }),
  );
});
