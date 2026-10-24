import type {
  SessionConfig,
  SessionInfo,
  SessionModelSelection,
} from "../shared/runs";
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
      ...(this.config?.fallbackModel
        ? { fallbackModel: this.config.fallbackModel }
        : {}),
      outputTokens: this.config?.outputTokens || 2048,
    };
  }

  configure(value: unknown): SessionInfo {
    this.config = validateSession(value);
    return this.info();
  }

  selectModels(value: unknown): SessionInfo {
    if (!this.config)
      throw new Error("Connect Nebius before choosing a model.");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) => key !== "model" && key !== "fallbackModel",
      )
    )
      throw new Error("Enter a valid model selection.");
    const selection = value as SessionModelSelection;
    this.config = validateSession({
      key: this.config.key,
      model: selection.model,
      fallbackModel: selection.fallbackModel,
      outputTokens: this.config.outputTokens,
    });
    return this.info();
  }

  close(): void {
    this.config = null;
  }
}
