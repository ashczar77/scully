import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentMessage } from "../src/renderer/AgentMessage";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import { characterCatalog } from "../src/shared/character-catalog";

const team = rosterMembers(starterRoster);

it("keeps speaker details outside the bubble and opens the full profile", () => {
  const person = team.find((member) => member.id === "maya")!;
  const onOpenProfile = vi.fn();
  const { container } = render(
    <AgentMessage
      name="Maya"
      person={person}
      at="2026-10-17T13:39:00.000Z"
      onOpenProfile={onOpenProfile}
    >
      I am checking the project files.
    </AgentMessage>,
  );

  const article = container.querySelector("article")!;
  const speaker = article.querySelector(".chat-speaker")!;
  const bubble = article.querySelector(".chat-agent-body")!;
  expect(article.classList.contains("chat-agent-maya")).toBe(true);
  expect(speaker.contains(bubble)).toBe(false);
  expect(within(bubble as HTMLElement).queryByText("Maya")).toBeNull();
  expect(
    within(bubble as HTMLElement).getByText("I am checking the project files."),
  ).toBeTruthy();
  expect(speaker.querySelector("time")?.getAttribute("datetime")).toBe(
    "2026-10-17T13:39:00.000Z",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open Maya's full profile" }),
  );
  expect(onOpenProfile).toHaveBeenCalledWith("maya");
});

it("gives teammates different bubble colors", () => {
  const { container, rerender } = render(
    <AgentMessage
      name="Pearl"
      person={team.find((member) => member.id === "pearl")!}
    >
      First message
    </AgentMessage>,
  );
  expect(
    container.querySelector("article")?.classList.contains("chat-agent-pearl"),
  ).toBe(true);
  rerender(
    <AgentMessage
      name="Ellis"
      person={team.find((member) => member.id === "ellis")!}
    >
      Second message
    </AgentMessage>,
  );
  expect(
    container.querySelector("article")?.classList.contains("chat-agent-ellis"),
  ).toBe(true);
});

it("assigns every available teammate a distinct bubble theme", () => {
  const members = rosterMembers({
    ...starterRoster,
    memberIds: characterCatalog.map((character) => character.id),
  });
  const { container } = render(
    <>
      {members.map((member) => (
        <AgentMessage key={member.id} name={member.name} person={member}>
          Message
        </AgentMessage>
      ))}
    </>,
  );
  const themes = Array.from(container.querySelectorAll("article")).map(
    (article) =>
      Array.from(article.classList).find(
        (name) => name.startsWith("chat-agent-") && name !== "chat-agent-body",
      ),
  );
  expect(new Set(themes).size).toBe(members.length);
});
