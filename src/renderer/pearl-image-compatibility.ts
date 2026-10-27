import type { PearlSandboxManifestFile } from "../shared/pearl-sandbox";

const stacks = [
  {
    name: "Java",
    file: /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$|\.(?:java|kt|kts)$/i,
    image: /java|jdk|gradle|maven|temurin/i,
  },
  {
    name: "Node",
    file: /(?:^|\/)package\.json$|\.(?:js|jsx|ts|tsx|mjs|cjs)$/i,
    image: /node|bun|deno/i,
  },
  {
    name: "Python",
    file: /(?:^|\/)(?:pyproject\.toml|requirements\.txt|Pipfile)$|\.py$/i,
    image: /python|conda/i,
  },
  {
    name: "Go",
    file: /(?:^|\/)go\.mod$|\.go$/i,
    image: /golang|(?:^|[/:])go(?=[:/\d-]|$)/i,
  },
  {
    name: "Rust",
    file: /(?:^|\/)Cargo\.toml$|\.rs$/i,
    image: /rust|cargo/i,
  },
] as const;

export function imageCompatibilityWarning(
  files: PearlSandboxManifestFile[],
  imageTag: string | undefined,
): string | null {
  if (!imageTag) return null;
  const missing = stacks
    .filter((stack) => files.some((file) => stack.file.test(file.path)))
    .filter((stack) => !stack.image.test(imageTag))
    .map((stack) => stack.name);
  if (!missing.length) return null;
  const label = missing.map((name) => `${name} project`).join(" and ");
  return `${label} files were found. The selected ${imageTag} image may not include the required runtime or build tools. Files can upload, but checks may fail until you choose or install a suitable runtime.`;
}
