import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PearlFileWorkbench } from "../src/renderer/PearlFileWorkbench";

it("opens local and Sandbox files as center tabs without activating source markup", () => {
  const select = vi.fn();
  const closeFile = vi.fn();
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "local",
          path: "src/index.html",
          source: "Local",
          content: "<script>window.bad = true</script>",
        },
        {
          id: "remote",
          path: "src/main.ts",
          source: "Sandbox",
          review: {
            path: "src/main.ts",
            before: "old",
            after: "new",
            binary: false,
          },
        },
      ]}
      activeId="local"
      onSelect={select}
      onCloseFile={closeFile}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText("File editor")).toHaveTextContent(
    "<script>window.bad = true</script>",
  );
  expect(
    screen.getByLabelText("File editor").querySelector("script"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "main.ts" }));
  expect(select).toHaveBeenCalledWith("remote");
  fireEvent.click(screen.getByRole("button", { name: "Close src/index.html" }));
  expect(closeFile).toHaveBeenCalledWith("local");
});

it("renders a bounded number of lines for a large file", () => {
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "large",
          path: "large.ts",
          source: "Local",
          content: Array.from(
            { length: 10_000 },
            (_, index) => `line ${index}`,
          ).join("\n"),
        },
      ]}
      activeId="large"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  expect(
    screen.getByLabelText("Code preview").querySelectorAll(".pearl-code-line")
      .length,
  ).toBeLessThanOrEqual(240);
});

it("keeps the virtual scroll height bounded for a million-line file", () => {
  render(
    <PearlFileWorkbench
      files={[
        {
          id: "million",
          path: "large.log",
          source: "Local",
          content: "x\n".repeat(1_000_000),
        },
      ]}
      activeId="million"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onClose={() => {}}
    />,
  );
  const preview = screen.getByLabelText("Code preview");
  const bottomSpacer = preview.querySelector(".pearl-code-lines")
    ?.lastElementChild as HTMLElement;
  expect(parseFloat(bottomSpacer.style.height)).toBeLessThan(8_000_000);
  expect(preview.querySelectorAll(".pearl-code-line")).toHaveLength(240);
});

it("offers tab cleanup actions for the selected tab", () => {
  const closeFiles = vi.fn();
  const files = ["one", "two", "three", "four"].map((id) => ({
    id,
    path: `${id}.ts`,
    source: "Local" as const,
    content: id,
  }));
  render(
    <PearlFileWorkbench
      files={files}
      activeId="three"
      onSelect={() => {}}
      onCloseFile={() => {}}
      onCloseFiles={closeFiles}
      onClose={() => {}}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("tab", { name: "three.ts" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Close tabs to the left" }),
  );
  expect(closeFiles).toHaveBeenCalledWith(["one", "two"]);
  fireEvent.click(screen.getByRole("button", { name: "Tab actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
  expect(closeFiles).toHaveBeenCalledWith(["one", "two", "four"]);
});
