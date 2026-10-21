import { build as bundle } from "esbuild";
import { build as renderer } from "vite";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
await renderer();
await mkdir("dist/branding", { recursive: true });
await mkdir("dist/fonts", { recursive: true });
await copyFile(
  "assets/branding/scully-friendly-nerd-transparent-v1.png",
  "dist/branding/scully.png",
);
await copyFile("assets/fonts/OFL.txt", "dist/fonts/ChelseaMarket-OFL.txt");
await bundle({
  entryPoints: {
    main: "src/main/pearl-main.ts",
    preload: "src/main/pearl-preload.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "node:sqlite"],
  sourcemap: false,
});
await rm("dist/worker.cjs", { force: true });
