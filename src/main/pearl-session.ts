import type { SessionConfig, SessionInfo } from "../shared/runs";
import { validateSession } from "../shared/runs";

export class PearlSession {
  private config: SessionConfig | null = null;

  current(): SessionConfig | null {
    return this.config && { ...this.config };
  }

  info(): SessionInfo {
    return {
      configured: this.config !== null,
      model: this.config?.model || "",
      outputTokens: this.config?.outputTokens || 2048,
    };
  }

  configure(value: unknown): SessionInfo {
    this.config = validateSession(value);
    return this.info();
  }

  close(): void {
    this.config = null;
  }
}
