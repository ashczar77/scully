import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { safeExternalUrl } from "./pearl-external-link";

export type InstalledBrowser = {
  id: string;
  label: string;
  executable: string;
};

/** Keep discovery to known browser locations and names, never model-supplied paths. */
export function installedBrowsers(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): InstalledBrowser[] {
  const options: { id: string; label: string; paths: string[] }[] = [];
  if (platform === "darwin") {
    options.push(
      {
        id: "safari",
        label: "Safari",
        paths: [
          "/Applications/Safari.app/Contents/MacOS/Safari",
          "/System/Applications/Safari.app/Contents/MacOS/Safari",
        ],
      },
      {
        id: "chrome",
        label: "Google Chrome",
        paths: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(
            homedir(),
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ),
        ],
      },
      {
        id: "firefox",
        label: "Firefox",
        paths: [
          "/Applications/Firefox.app/Contents/MacOS/firefox",
          join(homedir(), "Applications/Firefox.app/Contents/MacOS/firefox"),
        ],
      },
      {
        id: "edge",
        label: "Microsoft Edge",
        paths: [
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          join(
            homedir(),
            "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ),
        ],
      },
    );
  } else if (platform === "win32") {
    const roots = [
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"],
      env.LOCALAPPDATA,
    ].filter((root): root is string => Boolean(root));
    options.push(
      {
        id: "edge",
        label: "Microsoft Edge",
        paths: roots.map((root) =>
          join(root, "Microsoft/Edge/Application/msedge.exe"),
        ),
      },
      {
        id: "chrome",
        label: "Google Chrome",
        paths: roots.map((root) =>
          join(root, "Google/Chrome/Application/chrome.exe"),
        ),
      },
      {
        id: "firefox",
        label: "Firefox",
        paths: roots.map((root) => join(root, "Mozilla Firefox/firefox.exe")),
      },
    );
  } else if (platform === "linux") {
    const roots = (env.PATH || "/usr/bin:/bin")
      .split(delimiter)
      .filter(Boolean);
    options.push(
      {
        id: "firefox",
        label: "Firefox",
        paths: roots.map((root) => resolve(root, "firefox")),
      },
      {
        id: "chrome",
        label: "Google Chrome",
        paths: roots.flatMap((root) => [
          resolve(root, "google-chrome"),
          resolve(root, "google-chrome-stable"),
        ]),
      },
      {
        id: "chromium",
        label: "Chromium",
        paths: roots.flatMap((root) => [
          resolve(root, "chromium"),
          resolve(root, "chromium-browser"),
        ]),
      },
      {
        id: "edge",
        label: "Microsoft Edge",
        paths: roots.map((root) => resolve(root, "microsoft-edge")),
      },
    );
  }
  return options.flatMap((option) => {
    const executable = option.paths.find((path) => {
      if (!exists(path)) return false;
      if (platform === "linux") {
        try {
          accessSync(path, constants.X_OK);
        } catch {
          return false;
        }
      }
      return true;
    });
    return executable
      ? [{ id: option.id, label: option.label, executable }]
      : [];
  });
}

export async function openInBrowser(
  browser: InstalledBrowser,
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  url = safeExternalUrl(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(browser.executable, [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
