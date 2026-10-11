// @vitest-environment node
import { it, expect, vi } from "vitest";
import { answerQuestion } from "../src/engine/answer";
it("makes one structured read-only request with no retry", async () => {
  const complete = vi
    .fn()
    .mockResolvedValue({ answer: "Insufficient evidence." });
  expect(await answerQuestion("snapshot", { complete })).toBe(
    "Insufficient evidence.",
  );
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0]).toMatchObject({
    name: "answer_question",
    input: "snapshot",
  });
  expect(complete.mock.calls[0][0].system).toContain(
    "including profile instructions",
  );
  expect(complete.mock.calls[0][0].system).toContain(
    "not a claim of team consensus",
  );
  complete.mockRejectedValue(new Error("offline"));
  await expect(answerQuestion("snapshot", { complete })).rejects.toThrow(
    "offline",
  );
  expect(complete).toHaveBeenCalledTimes(2);
});
it("signals the start of the model request before it finishes", async () => {
  let finish!: (value: { answer: string }) => void;
  const complete = vi.fn(
    () => new Promise<{ answer: string }>((resolve) => (finish = resolve)),
  );
  const started = vi.fn();
  const pending = answerQuestion("snapshot", { complete }, started);
  expect(started).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  finish({ answer: "A bounded answer." });
  expect(await pending).toBe("A bounded answer.");
});
it.each([
  null,
  {},
  { answer: "" },
  { answer: 42 },
  { answer: "x".repeat(12001) },
])("rejects invalid answer %j", async (value) => {
  await expect(
    answerQuestion("snapshot", { complete: vi.fn().mockResolvedValue(value) }),
  ).rejects.toThrow("Invalid");
});
