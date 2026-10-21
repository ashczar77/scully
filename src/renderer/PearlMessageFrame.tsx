import type { ReactNode } from "react";
import pearlPortrait from "../../assets/team-portrait-coordinator-v1.png";

export function messageTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function PearlMessageFrame({
  role,
  at,
  progress = false,
  draft = false,
  children,
}: {
  role: "user" | "assistant";
  at?: string;
  progress?: boolean;
  draft?: boolean;
  children: ReactNode;
}) {
  const time = messageTime(at);
  return (
    <article
      className={`pearl-message ${role}${progress ? " pearl-progress" : ""}`}
      aria-label={draft ? "Pearl draft" : undefined}
    >
      {role === "assistant" && (
        <img className="pearl-message-avatar" src={pearlPortrait} alt="" />
      )}
      <div className="pearl-message-content">
        <div className="pearl-message-meta">
          <span className="pearl-speaker">
            {role === "user" ? "You" : "Pearl"}
          </span>
          {time && <time dateTime={at}>{time}</time>}
        </div>
        <div className="pearl-message-bubble">{children}</div>
      </div>
    </article>
  );
}
