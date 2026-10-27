import { expect, it } from "vitest";
import { addWorkbenchTab } from "../src/renderer/pearl-workbench-tabs";

const file = (index: number) => ({
  id: `file-${index}`,
  path: `file-${index}.ts`,
  source: "Local" as const,
  content: String(index),
});

it("evicts the oldest inactive viewing tab at the ten-tab limit", () => {
  const existing = Array.from({ length: 10 }, (_, index) => file(index));
  const next = addWorkbenchTab(existing, file(10), "file-0");
  expect(next).toHaveLength(10);
  expect(next.map((item) => item.id)).not.toContain("file-1");
  expect(next.map((item) => item.id)).toContain("file-0");
  expect(next.at(-1)?.id).toBe("file-10");
});

it("reopening a tab updates it and moves it to the newest position", () => {
  const next = addWorkbenchTab(
    [file(0), file(1)],
    { ...file(0), content: "updated" },
    "file-1",
  );
  expect(next.map((item) => item.id)).toEqual(["file-1", "file-0"]);
  expect(next.at(-1)?.content).toBe("updated");
});
