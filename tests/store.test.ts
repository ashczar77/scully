// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/main/store";
it("persists real SQLite tasks and profiles across reopen without duplicating defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-store-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().teammates).toHaveLength(3);
    const task = db.createTask({
      title: "Build it",
      description: "Test persistence",
      mode: "plan",
    });
    db.updateTeammate({ ...db.load().teammates[0], name: "Maya Edited" });
    db.close();
    db = undefined;
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().tasks).toEqual([task]);
    expect(db.load().teammates).toHaveLength(3);
    expect(db.load().teammates[0].name).toBe("Maya Edited");
    expect(() =>
      db!.createTask({ title: " ", mode: "plan", description: "" }),
    ).toThrow();
    expect(db.load().tasks).toHaveLength(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
