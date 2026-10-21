import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AutoGrowTextarea } from "../src/renderer/AutoGrowTextarea";

it("grows with multiline text and keeps the scrollbar hidden while content fits", () => {
  const scrollHeight = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockReturnValue(120);
  const { rerender } = render(
    <AutoGrowTextarea
      aria-label="Message"
      value="One line"
      onChange={() => {}}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Message" });
  rerender(
    <AutoGrowTextarea
      aria-label="Message"
      value="One line\nSecond line"
      onChange={() => {}}
    />,
  );
  expect(input).toHaveStyle({ height: "120px", overflowY: "hidden" });
  scrollHeight.mockRestore();
});
