// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  confirmExternalLink,
  safeExternalUrl,
} from "../src/main/pearl-external-link";

it("accepts ordinary web links and rejects local or executable schemes", () => {
  expect(safeExternalUrl("https://example.com/path?q=1")).toBe(
    "https://example.com/path?q=1",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///tmp/private",
    "mailto:a@example.com",
    "https://user:secret@example.com",
    "https://example.com/\nnext",
    "not-a-url",
  ])
    expect(() => safeExternalUrl(value)).toThrow();
});

it("opens only after confirmation and lets users copy without opening", async () => {
  const open = vi.fn(async () => {});
  const copy = vi.fn();
  const confirm = vi.fn(async () => "cancel" as "cancel" | "copy" | "open");
  expect(
    await confirmExternalLink("https://example.com/", confirm, open, copy),
  ).toBe("cancel");
  expect(open).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce("copy");
  expect(
    await confirmExternalLink("https://example.com/", confirm, open, copy),
  ).toBe("copy");
  expect(copy).toHaveBeenCalledWith("https://example.com/");
  expect(open).not.toHaveBeenCalled();
  confirm.mockResolvedValueOnce("open");
  expect(
    await confirmExternalLink("https://example.com/", confirm, open, copy),
  ).toBe("open");
  expect(open).toHaveBeenCalledWith("https://example.com/");
  await expect(
    confirmExternalLink("data:text/html,bad", confirm, open, copy),
  ).rejects.toThrow();
  expect(confirm).toHaveBeenCalledTimes(3);
});

it("handles a system browser launch failure without losing the validated link", async () => {
  const open = vi.fn(async () => {
    throw new Error("Failed to open URL");
  });
  const copy = vi.fn();
  const recover = vi.fn(async () => "copy" as const);
  await expect(
    confirmExternalLink(
      "https://example.com/repo",
      async () => "open",
      open,
      copy,
      recover,
    ),
  ).resolves.toBe("copy");
  expect(recover).toHaveBeenCalledWith("https://example.com/repo", true);
  expect(copy).toHaveBeenCalledWith("https://example.com/repo");
});

it("retries a failed browser launch once and keeps the same validated URL", async () => {
  const open = vi
    .fn<(_url: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("Browser not responding"))
    .mockResolvedValueOnce();
  const copy = vi.fn();
  const recover = vi.fn(async () => "retry" as const);
  await expect(
    confirmExternalLink(
      "https://example.com/repo",
      async () => "open",
      open,
      copy,
      recover,
    ),
  ).resolves.toBe("open");
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenNthCalledWith(2, "https://example.com/repo");
  expect(recover).toHaveBeenCalledWith("https://example.com/repo", true);
  expect(copy).not.toHaveBeenCalled();
});

it("stops after a second failed browser launch", async () => {
  const open = vi.fn(async () => {
    throw new Error("No browser handler");
  });
  const recover = vi.fn(async () => "retry" as const);
  await expect(
    confirmExternalLink(
      "https://example.com/",
      async () => "open",
      open,
      vi.fn(),
      recover,
    ),
  ).resolves.toBe("cancel");
  expect(open).toHaveBeenCalledTimes(2);
  expect(recover).toHaveBeenNthCalledWith(1, "https://example.com/", true);
  expect(recover).toHaveBeenNthCalledWith(2, "https://example.com/", false);
});

it("opens in another browser after the system default fails", async () => {
  const openDefault = vi.fn(async () => {
    throw new Error("Failed to open URL");
  });
  const openChoice = vi.fn(async (_url: string) => {});
  expect(
    await confirmExternalLink(
      "https://example.com/",
      async () => "open",
      openDefault,
      vi.fn(),
      async (url) => {
        await openChoice(url);
        return "open";
      },
    ),
  ).toBe("open");
  expect(openChoice).toHaveBeenCalledWith("https://example.com/");
  expect(openDefault).toHaveBeenCalledTimes(1);
});
