import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { Run } from "../shared/runs";

export function ProjectLocation({
  api,
  run,
  onUpdated,
}: {
  api: DesktopAPI;
  run: Run;
  onUpdated: (run: Run) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (run.workspaceMode !== "direct") return null;
  return (
    <section className="project-location" aria-label="Project location">
      <strong>Project location</strong>
      {run.projectWorkspace ? (
        <>
          <p>
            The team will work in this{" "}
            {run.projectWorkspace.kind === "new"
              ? "new project folder"
              : "selected checkout"}
            .
          </p>
          <code>{run.projectWorkspace.path}</code>
        </>
      ) : (
        <>
          <p>
            Where should the team create this project? Choose an empty folder or
            a new Git repository before building.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api
                .chooseProjectWorkspace(run.id)
                .then((updated) => {
                  if (updated) onUpdated(updated);
                })
                .catch((reason) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not choose the project folder.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <FolderOpen size={16} aria-hidden="true" /> Choose project folder
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
