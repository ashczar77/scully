import { expect, it } from "vitest";
import {
  routeTeamMessage,
  parseMessageRoutingSettings,
} from "../src/shared/message-routing";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";

const team = rosterMembers({
  ...starterRoster,
  memberIds: [...starterRoster.memberIds, "sloane", "kiran", "nadine"],
});
const settings = {
  unclear: "pearl",
  specialistConsultation: "automatic",
} as const;
it("does not infer an expert from keywords in message text", () => {
  expect(
    routeTeamMessage("How should the layout adapt?", team, settings)
      .recipientId,
  ).toBe("pearl");
  expect(
    routeTeamMessage("How should authentication work?", team, settings)
      .recipientId,
  ).toBe("pearl");
});
it("uses the tagged teammate and rejects unknown or multiple tags", () => {
  expect(
    routeTeamMessage("@Sloane can you check this?", team, settings).recipientId,
  ).toBe("sloane");
  expect(() =>
    routeTeamMessage("@Nico can you check this?", team, settings),
  ).toThrow(/not on this task/);
  expect(() => routeTeamMessage("@Sloane @Kiran help", team, settings)).toThrow(
    /one teammate/,
  );
});
it("handles unclear and cross-role questions by the saved preference", () => {
  expect(routeTeamMessage("Can you help?", team, settings).recipientId).toBe(
    "pearl",
  );
  expect(
    routeTeamMessage("Can you review the UI tests?", team, {
      ...settings,
      unclear: "ask",
    }).needsChoice,
  ).toBe(true);
});
it("rejects invalid settings instead of silently changing a permission-related default", () => {
  expect(() => parseMessageRoutingSettings({ unclear: "anyone" })).toThrow();
  expect(() =>
    parseMessageRoutingSettings({
      unclear: "pearl",
      specialistConsultation: "anyone",
    }),
  ).toThrow();
});
