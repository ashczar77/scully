import { expect, it } from "vitest";
import {
  createCollaboration,
  askCollaborationQuestion,
  sendCollaborationMessage,
  manifestFor,
} from "../src/shared/collaboration";

it("routes a changed decision by explicit question identity and preserves its original wording", () => {
  const files = [{ path: "app.ts", content: "base" }];
  const state = createCollaboration(
    "task",
    {
      projectPath: "/project",
      projectDev: 1,
      projectIno: 2,
      projectId: "local",
      mode: "local",
      baseImageId: null,
      manifest: manifestFor(files),
      allowedCommands: [],
      approvedAt: "now",
    },
    files,
    [
      {
        id: "maya",
        name: "Maya",
        role: "builder",
        permissions: ["read", "edit"],
        model: "fixture",
        thinking: "off",
      },
    ],
  );
  const question = askCollaborationQuestion(
    state,
    "maya",
    "user",
    "Which framework?",
    state.baseId,
  );
  const text =
    "Actually, Vue works better for this screen.\n\nKeep the keyboard flow.";
  const answer = sendCollaborationMessage(
    state,
    "user",
    "maya",
    text,
    state.baseId,
    question.id,
  );
  expect(answer.text).toBe(text);
  expect(state.questions[0]).toMatchObject({
    status: "answered",
    resolutionEventId: answer.id,
  });
});
