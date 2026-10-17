import type { ReactNode } from "react";
import type { Teammate } from "../shared/contracts";
import { Portrait } from "./Portrait";

export function messageTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const speakerColors: Record<string, string> = {
  pearl: "pearl",
  maya: "maya",
  ellis: "ellis",
  jun: "jun",
  sloane: "sloane",
  nadine: "nadine",
  tessa: "tessa",
  adrian: "adrian",
  malik: "malik",
  meryl: "meryl",
  rafi: "rafi",
  carmen: "carmen",
  kiran: "kiran",
  jess: "jess",
  nico: "nico",
  james: "james",
};

export function AgentMessage({
  name,
  person,
  children,
  className = "",
  status,
  at,
  onOpenProfile,
}: {
  name: string;
  person?: Teammate;
  children: ReactNode;
  className?: string;
  status?: boolean;
  at?: string;
  onOpenProfile?: (id: string) => void;
}) {
  const color = speakerColors[person?.id || ""] || "teammate";
  const time = messageTime(at);
  return (
    <article
      className={`chat-agent chat-agent-${color} ${className}`.trim()}
      role={status ? "status" : undefined}
    >
      <div className="chat-speaker">
        {person && onOpenProfile ? (
          <button
            type="button"
            className="chat-speaker-profile"
            onClick={() => onOpenProfile(person.id)}
            aria-label={`Open ${name}'s full profile`}
          >
            <Portrait person={person} className="chat-avatar" />
            <strong>{name}</strong>
          </button>
        ) : (
          <div className="chat-speaker-identity">
            {person ? (
              <Portrait person={person} className="chat-avatar" />
            ) : (
              <span
                className="chat-avatar chat-avatar-fallback"
                aria-hidden="true"
              >
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <strong>{name}</strong>
          </div>
        )}
        {time && <time dateTime={at}>{time}</time>}
      </div>
      <div className="chat-agent-body">{children}</div>
    </article>
  );
}

export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <span className="chat-thinking">
      <span>{label}</span>
      <span className="chat-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
