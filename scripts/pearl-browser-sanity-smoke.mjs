import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectStaticWebApp } from "./live-browser-sanity.mjs";

const root = await mkdtemp(join(tmpdir(), "scully-browser-sanity-"));
const project = join(root, "project");
const state = join(root, "state");
await mkdir(project);
await mkdir(state);
await writeFile(
  join(root, "outside.js"),
  "document.body.append(' symlink content escaped');",
);
await writeFile(
  join(project, ".env"),
  "document.body.append(' private content escaped');",
);
await symlink(join(root, "outside.js"), join(project, "linked.js"));
let app;
try {
  await writeFile(
    join(project, "index.html"),
    '<!doctype html><title>Fixture</title><style>#form[hidden]{display:flex}</style><p>Public page</p><form id="form" hidden>Private form</form><script src="linked.js"></script><script src=".env"></script><script src="https://example.com/external.js"></script>',
  );
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SCULLY_TEST_DATA: state },
  });
  const failed = await inspectStaticWebApp(app, project);
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.hiddenViolations, [{ tag: "form", id: "form" }]);
  assert.doesNotMatch(failed.visibleText, /symlink content escaped/);
  assert.doesNotMatch(failed.visibleText, /private content escaped/);
  assert(failed.deniedExternalRequests > 0);

  await writeFile(
    join(project, "index.html"),
    '<!doctype html><title>Fixture</title><p>Public page</p><form id="form" hidden>Private form</form>',
  );
  const passed = await inspectStaticWebApp(app, project);
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.hiddenViolations, []);
  assert.match(passed.visibleText, /Public page/);
  process.stdout.write(
    "PASS: isolated browser sanity detects hidden-state defects and blocks external, private and symlinked content.\n",
  );
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
