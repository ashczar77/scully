export function safeTestCommand(value) {
  if (!value || !Array.isArray(value.args)) return false;
  if (value.command === "node") {
    const args = value.args;
    if (args.length === 1 && args[0] === "--test") return true;
    const paths = args[0] === "--test" ? args.slice(1) : args;
    if (paths.length < 1 || paths.length > (args[0] === "--test" ? 8 : 1))
      return false;
    return paths.every(
      (path) =>
        typeof path === "string" &&
        /^tests?(?:\/[A-Za-z0-9._/-]+)?(?:\.js|\/)?$/.test(path) &&
        !path.includes(".."),
    );
  }
  return (
    value.command === "go" &&
    [
      '["test","-v","-count=1","./."]',
      '["test","-v","-count=1","./..."]',
    ].includes(JSON.stringify(value.args))
  );
}

export function safePreviewCommand(value) {
  return (
    value?.command === "node" &&
    Array.isArray(value.args) &&
    value.args.length === 1 &&
    typeof value.args[0] === "string" &&
    /^[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(?:cjs|mjs|js)$/.test(value.args[0]) &&
    !value.args[0].includes("..")
  );
}
