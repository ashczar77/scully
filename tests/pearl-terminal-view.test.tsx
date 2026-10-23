import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopAPI } from "../src/shared/contracts";
import type { PearlTerminalState } from "../src/shared/pearl-chat";

const events = vi.hoisted(() => [] as string[]);

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = { disableStdin: false };
    textarea = document.createElement("textarea");
    loadAddon() {}
    open() {
      events.push("open");
    }
    write(value: string) {
      events.push(`write:${value}`);
    }
    reset() {
      events.push("reset");
    }
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      events.push("fit");
    }
  },
}));

import { PearlTerminalView } from "../src/renderer/PearlTerminalView";

const api = {
  resizePearlTerminal: vi.fn(async () => {}),
  sendPearlTerminalInput: vi.fn(async () => {}),
} as unknown as DesktopAPI;

function state(output: string, outputStart = 0): PearlTerminalState {
  return {
    id: "terminal-view",
    revision: 1,
    command: "node",
    args: [],
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    output,
    outputStart,
    truncated: outputStart > 0,
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  events.length = 0;
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("fits the visible terminal before replaying persisted output", async () => {
  render(
    <PearlTerminalView api={api} chatId="chat" terminal={state("PAGE")} />,
  );
  await waitFor(() => expect(events).toContain("write:PAGE"));
  expect(events.indexOf("fit")).toBeLessThan(events.indexOf("write:PAGE"));
  expect(window.requestAnimationFrame).toHaveBeenCalled();
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
    block: "center",
  });
});

it("keeps the live screen when the retained output tail advances", async () => {
  const { rerender } = render(
    <PearlTerminalView api={api} chatId="chat" terminal={state("FIRST")} />,
  );
  await waitFor(() => expect(events).toContain("write:FIRST"));
  rerender(
    <PearlTerminalView
      api={api}
      chatId="chat"
      terminal={state("LATEST", 10)}
    />,
  );
  await waitFor(() => expect(events).toContain("write:LATEST"));
  expect(events).not.toContain("reset");
});
