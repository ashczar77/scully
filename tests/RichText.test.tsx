import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  CopyTextActions,
  RichText,
  readablePearlMarkdown,
} from "../src/renderer/RichText";

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

it("keeps nested lists, quotes, tables and fenced code as formatted blocks", () => {
  render(
    <RichText
      text={
        "# Release\n\n> **Check** this first.\n\n1. Parent\n   - Child\n2. Next\n\n| Key | Value |\n| --- | --- |\n| mode | local |\n\n```ts\nconst x = 1;\n```"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Release" })).toBeInTheDocument();
  expect(screen.getByText("Check").closest("blockquote")).toBeInTheDocument();
  expect(screen.getByText("Child").closest("ol")).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent("mode");
  expect(screen.getByText("const x = 1;").closest("pre")).toBeInTheDocument();
});

it("breaks up a long plain Pearl reply for reading without changing its words", () => {
  const text = [
    "The project contains a catalog with product pages and a cart.",
    "The cart keeps quantities in local storage and calculates a running total.",
    "I opened the catalog and checked that each product is available.",
    "I then added a product and confirmed that the cart total changed.",
    "The checkout form collects a name and address for a mock order.",
    "The browser check showed the confirmation screen after submission.",
    "To run the project locally, serve its folder with a static server.",
    "The current version does not send orders to a backend service.",
    "The remaining work is to connect a real payment and order flow.",
  ].join(" ");
  expect(text.length).toBeGreaterThan(500);
  const readable = readablePearlMarkdown(text);
  expect(readable).toContain("\n\n");
  expect(readable.replace(/\n\n/g, " ")).toBe(text);
  render(<RichText text={text} readableProse />);
  expect(document.querySelectorAll(".rich-text p").length).toBeGreaterThan(1);
});

it("preserves existing Markdown and short replies", () => {
  const markdown =
    "## Result\n\n- One\n- Two\n\n```sh\nnode --check index.js\n```";
  expect(readablePearlMarkdown(markdown)).toBe(markdown);
  expect(readablePearlMarkdown("A short answer.")).toBe("A short answer.");
});
