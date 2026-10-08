import { build as bundle } from "esbuild";
import { build as renderer } from "vite";
await renderer();
await bundle({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "node:sqlite"],
  sourcemap: false,
});
