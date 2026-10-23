import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { DesktopAPI } from "../shared/contracts";
import type { PearlTerminalState } from "../shared/pearl-chat";
import "@xterm/xterm/css/xterm.css";

export function PearlTerminalView({
  api,
  chatId,
  terminal,
}: {
  api: DesktopAPI;
  chatId: string;
  terminal: PearlTerminalState;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Terminal | null>(null);
  const outputEnd = useRef<number | null>(null);
  const latestTerminal = useRef(terminal);
  const running = useRef(terminal.status === "running");
  const [error, setError] = useState("");
  latestTerminal.current = terminal;
  running.current = terminal.status === "running";

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const view = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      scrollback: 1000,
      theme: {
        background: "#0d171c",
        foreground: "#dcece9",
        cursor: "#46dfcc",
        selectionBackground: "#336a67",
      },
    });
    const fit = new FitAddon();
    view.loadAddon(fit);
    view.open(element);
    view.textarea?.setAttribute(
      "aria-label",
      `Interactive ${terminal.command} terminal`,
    );
    instance.current = view;
    view.options.disableStdin = !running.current;

    let live = true;
    let inputQueue = Promise.resolve();
    const subscription = view.onData((data) => {
      if (!running.current || !data) return;
      if (data.length > 65_536) {
        setError("Input is too large to paste at once.");
        return;
      }
      const characters = Array.from(data);
      const chunks: string[] = [];
      for (let offset = 0; offset < characters.length; offset += 1000)
        chunks.push(characters.slice(offset, offset + 1000).join(""));
      inputQueue = inputQueue
        .then(async () => {
          for (const chunk of chunks) {
            if (!live) break;
            await api.sendPearlTerminalInput(chatId, terminal.id, chunk);
          }
        })
        .catch((cause) => {
          if (live) setError(String(cause));
        });
    });

    let lastSize = "";
    const fitAndResize = () => {
      if (!live || element.clientWidth < 80 || element.clientHeight < 50)
        return;
      fit.fit();
      if (outputEnd.current === null) {
        const current = latestTerminal.current;
        view.write(current.output);
        outputEnd.current = (current.outputStart || 0) + current.output.length;
      }
      if (!running.current) return;
      const cols = Math.max(20, Math.min(300, view.cols));
      const rows = Math.max(5, Math.min(120, view.rows));
      const size = `${cols}x${rows}`;
      if (size === lastSize) return;
      lastSize = size;
      void api
        .resizePearlTerminal(chatId, terminal.id, cols, rows)
        .catch((cause) => {
          if (live) setError(String(cause));
        });
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(fitAndResize);
    observer?.observe(element);
    window.addEventListener("resize", fitAndResize);
    const frame = requestAnimationFrame(() => {
      fitAndResize();
      if (running.current) element.scrollIntoView({ block: "center" });
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fitAndResize);
      observer?.disconnect();
      subscription.dispose();
      view.dispose();
      instance.current = null;
      outputEnd.current = null;
    };
  }, [api, chatId, terminal.id]);

  useEffect(() => {
    const view = instance.current;
    if (!view) return;
    view.options.disableStdin = terminal.status !== "running";
    const start = terminal.outputStart || 0;
    const end = start + terminal.output.length;
    const seen = outputEnd.current;
    if (seen === null) return;
    if (seen > end) {
      view.reset();
      view.write(terminal.output);
    } else if (seen < start) {
      // Keep the live screen when the persisted tail advances past our cursor.
      // Resetting would replay an incomplete ANSI stream into an empty screen.
      view.write(terminal.output);
    } else if (end > seen) {
      view.write(terminal.output.slice(seen - start));
    }
    outputEnd.current = end;
  }, [terminal.output, terminal.outputStart, terminal.status]);

  return (
    <>
      <div className="pearl-terminal-screen" ref={host} />
      {error && <p className="pearl-terminal-error">{error}</p>}
    </>
  );
}
