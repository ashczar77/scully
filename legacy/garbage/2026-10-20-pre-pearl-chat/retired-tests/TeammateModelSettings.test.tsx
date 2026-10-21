import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeammateModelSettings } from "../src/renderer/TeammateModelSettings";
import { defaultRoleModelSettings } from "../src/shared/role-models";
import type { DesktopAPI } from "../src/shared/contracts";

function api(listModels: DesktopAPI["listModels"]): DesktopAPI {
  return {
    roleModelSettings: vi.fn().mockResolvedValue(defaultRoleModelSettings),
    session: vi
      .fn()
      .mockResolvedValue({ configured: true, model: "", outputTokens: 2048 }),
    listModels,
    setRoleModelSettings: vi.fn().mockImplementation(async (value) => value),
  } as unknown as DesktopAPI;
}

it("shows recommended models first, then the returned catalog and incompatible reasons", async () => {
  const bridge = api(
    vi.fn().mockResolvedValue([
      { id: "vendor/chat-model", name: "Chat model" },
      {
        id: "vendor/embedding",
        name: "Embedding",
        disabledReason: "This model does not support chat completions",
      },
    ]),
  );
  render(<TeammateModelSettings api={bridge} />);
  await waitFor(() => expect(bridge.listModels).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /Builders model:/ }));
  const dialog = screen.getByRole("dialog", { name: "Choose builders model" });
  expect(
    within(dialog).getByRole("heading", { name: "Recommended" }),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("All models")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("option", { name: "Chat model" }),
  ).toBeEnabled();
  expect(
    within(dialog).getByRole("option", { name: "Embedding" }),
  ).toBeDisabled();
  expect(
    within(dialog).getByText("This model does not support chat completions"),
  ).toBeInTheDocument();
});

it("explains catalog failure inside the picker and can retry", async () => {
  const listModels = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([{ id: "vendor/chat-model", name: "Chat model" }]);
  render(<TeammateModelSettings api={api(listModels)} />);
  fireEvent.click(screen.getByRole("button", { name: /Pearl model:/ }));
  const dialog = screen.getByRole("dialog", { name: "Choose pearl model" });
  expect(
    await within(dialog).findByText(/could not be loaded/),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  expect(
    await within(dialog).findByRole("option", { name: "Chat model" }),
  ).toBeInTheDocument();
});
