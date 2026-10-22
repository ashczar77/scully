import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function key(env, name) {
  const fromEnv = env[name];
  if (fromEnv) return fromEnv;
  const line = env.file
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

const local = {
  ...process.env,
  file: await readFile(".env", "utf8"),
};
const nebius = key(local, "NEBIUS_API_KEY");
const tavily = key(local, "TAVILY_API_KEY");
if (!nebius || !tavily)
  throw new Error(
    "Both Nebius and Tavily keys are required for this opt-in check",
  );

const root = await mkdtemp(join(tmpdir(), "scully-pearl-web-live-"));
const state = join(root, "state");
await mkdir(state, { mode: 0o700 });
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SCULLY_TEST_DATA: state,
      SCULLY_LIVE_TEST: "1",
      SCULLY_LIVE_MAX_REQUESTS: "8",
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.evaluate(
    async ({ nebius, tavily }) => {
      await window.scully.configureSession({
        key: nebius,
        model: "zai-org/GLM-5.3-Flash",
        outputTokens: 8192,
      });
      await window.scully.configureWebSearch(tavily);
    },
    { nebius, tavily },
  );
  await page.getByRole("button", { name: "New chat" }).click();
  const chatId = (await page.evaluate(() => window.scully.listPearlChats()))[0]
    .id;
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill(
      "Please search the web for the official TypeScript 5.9 release notes, read one official result, then tell me one documented feature with its direct source link.",
    );
  await page.getByRole("button", { name: "Send message" }).click();
  const deadline = Date.now() + 180_000;
  let chat;
  do {
    chat = await page.evaluate((id) => window.scully.getPearlChat(id), chatId);
    if (chat.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  const metrics = await page.evaluate(() => window.scully.metrics());
  const calls = chat.messages
    .filter((item) => item.role === "tool")
    .map((item) => ({ name: item.toolName, text: item.text }));
  const answer = chat.messages
    .filter((item) => item.role === "assistant")
    .at(-1)?.text;
  const returnedUrls = calls
    .filter((item) => item.name === "search_web")
    .flatMap((item) => {
      try {
        return JSON.parse(item.text).results.map((result) => result.url);
      } catch {
        return [];
      }
    });
  await mkdir("test-results", { recursive: true });
  const output = join("test-results", `pearl-web-live-${Date.now()}.json`);
  await writeFile(
    output,
    JSON.stringify(
      { status: chat.status, error: chat.error, calls, answer },
      null,
      2,
    ),
  );
  const summary = {
    status: chat.status,
    modelRequests: metrics.events.filter(
      (item) => item.operation === "model.request",
    ).length,
    actions: calls.map((item) => item.name),
    cited: returnedUrls.some((url) => answer?.includes(url)),
    record: output,
  };
  console.log(JSON.stringify(summary));
  if (
    chat.status !== "idle" ||
    !summary.actions.includes("search_web") ||
    !summary.actions.includes("read_web_result") ||
    !summary.cited
  )
    throw new Error("Connected Room web search did not pass");
} finally {
  await app?.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}
