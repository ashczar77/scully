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
