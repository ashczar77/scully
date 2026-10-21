import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { isolatedCommand } from "./pearl-command-sandbox";

export type PreviewLauncher = (
  executable: string,
  args: string[],
  project: string,
  scratch: string,
  port: number,
) => ChildProcess;

const launch: PreviewLauncher = (executable, args, project, scratch, port) => {
  const command = isolatedCommand(executable, args, project, scratch);
  return spawn(command.executable, command.args, {
    cwd: project,
    env: { ...command.env, PORT: String(port), HOST: "127.0.0.1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
};

// The caller supplies a reviewed executable. The browser receives only the
// fresh loopback origin allocated here, never an arbitrary model-supplied URL.
export async function withProjectPreview<T>(
  executable: string,
  args: string[],
  project: string,
  inspect: (origin: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  options: { launch?: PreviewLauncher; timeoutMs?: number } = {},
): Promise<T & { serverOutput: string }> {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  signal?.addEventListener("abort", aborted, { once: true });
  const timer = setTimeout(aborted, options.timeoutMs ?? 90_000);
  const scratch = mkdtempSync(join(project, ".scully-command-"));
  let child: ChildProcess | undefined;
  let output = "";
  try {
    if (signal?.aborted) controller.abort();
    controller.signal.throwIfAborted();
    const reservation = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const port = (reservation.address() as { port: number }).port;
        reservation.close((error) => (error ? reject(error) : resolve(port)));
      });
    });
    child = (options.launch || launch)(
      executable,
      args,
      project,
      scratch,
      port,
    );
    let failure: Error | undefined;
    child.on("error", (error) => {
      failure = error;
    });
    const collect = (value: Buffer) => {
      output = (output + value.toString()).slice(-16_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    while (true) {
      controller.signal.throwIfAborted();
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Preview server exited before it was ready. ${output}`);
      try {
        const response = await fetch(origin, {
          redirect: "manual",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(500),
          ]),
        });
        await response.body?.cancel();
        break;
      } catch {
        if (Date.now() >= deadline)
          throw new Error(
            `Preview server did not listen on HOST and PORT. ${output}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const result = await inspect(origin, controller.signal);
    return { ...result, serverOutput: output };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    if (child?.pid) {
      // Kill the process group, including descendants, on completion or Stop.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          child!.once("exit", () => resolve());
          setTimeout(resolve, 1000).unref();
        });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

export type RunningPreview = {
  origin: string;
  active: () => boolean;
  close: () => Promise<void>;
};

export async function startProjectPreview(
  executable: string,
  args: string[],
  project: string,
  signal?: AbortSignal,
): Promise<RunningPreview> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let alive = true;
  let announce!: (preview: RunningPreview) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<RunningPreview>((resolve, reject) => {
    announce = resolve;
    rejectReady = reject;
  });
  const running = withProjectPreview(
    executable,
    args,
    project,
    async (origin, lifetime) => {
      announce({
        origin,
        active: () => alive && !controller.signal.aborted && !lifetime.aborted,
        close: async () => {
          controller.abort();
          await running.catch(() => {});
        },
      });
      await new Promise<void>((resolve) => {
        if (lifetime.aborted) resolve();
        else
          lifetime.addEventListener("abort", () => resolve(), { once: true });
      });
      return {};
    },
    controller.signal,
    { timeoutMs: 10 * 60 * 1000 },
  );
  void running.catch(rejectReady).finally(() => {
    alive = false;
    signal?.removeEventListener("abort", abort);
  });
  return ready;
}
