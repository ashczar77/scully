import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CopyTextActions, RichText } from "../src/renderer/RichText";

it("renders model Markdown without displaying its syntax or executing HTML", () => {
  render(
    <RichText
      text={
        "## Overview\nBuild **locally** with `localStorage`.\n- Keyboard support\n- <script>alert(1)</script>"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  expect(screen.getByText("locally").tagName).toBe("STRONG");
  expect(screen.getByText("localStorage").tagName).toBe("CODE");
  expect(screen.getByText("Keyboard support").tagName).toBe("LI");
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByText("## Overview")).toBeNull();
});

it("copies readable text or the original Markdown on request", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  render(
    <CopyTextActions
      text={"## Plan\nBuild **locally**."}
      copyText={writeText}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
  expect(writeText).toHaveBeenCalledWith("Plan\nBuild locally.");
  fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
  expect(writeText).toHaveBeenCalledWith("## Plan\nBuild **locally**.");
});

it("shows a visible error when the desktop clipboard rejects a copy", async () => {
  const copyText = vi
    .fn()
    .mockRejectedValue(new Error("Clipboard unavailable"));
  render(<CopyTextActions text="Plan" copyText={copyText} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy");
});

it("does not turn unsafe links or image Markdown into active content", () => {
  render(
    <RichText text="[unsafe](javascript:alert) ![remote image](https://example.com/a.png)" />,
  );
  expect(screen.getByText("unsafe")).not.toHaveAttribute("href");
  expect(screen.getByText("remote image")).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
});
