import { useState } from "react";
import type { RunAPI } from "../shared/runs";
import type { ArtifactInventory, ArtifactKind } from "../shared/artifacts";

const labels: Record<ArtifactKind, string> = {
  drafts: "Draft branches",
  executions: "Local check copies",
  applications: "Application backups",
};

export function StoragePanel({ api }: { api: RunAPI }) {
  const [inventory, setInventory] = useState<ArtifactInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="settings-card" aria-label="Local storage">
      <h2>Local storage</h2>
      <p>
        Tasks, runs and teammate profiles are stored in local SQLite. Draft
        branches, local check copies and application backups are retained in
        separate private folders.
      </p>
      <p className="muted">
        This is a read-only inventory. Counts are bounded and file sizes are
        logical bytes, not measured disk usage. No files are deleted.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setInventory(null);
          try {
            setInventory(await api.inspectLocalArtifacts());
          } catch {
            setError("Storage inventory unavailable");
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh storage inventory
      </button>
      {inventory && (
        <>
          <p>Inspected at {new Date(inventory.checkedAt).toLocaleString()}.</p>
          <ul>
            {inventory.categories.map((category) => (
              <li key={category.kind}>
                <strong>{labels[category.kind]}</strong>:{" "}
                {category.status === "missing"
                  ? "No saved artifacts found."
                  : category.status === "unavailable"
                    ? "Unavailable to inspect."
                    : category.status === "partial"
                      ? `Partial count: at least ${category.items} items, ${category.files} files, ${category.logicalBytes} bytes. Some entries were skipped or the scan limit was reached.`
                      : `${category.items} items, ${category.files} files, ${category.logicalBytes} bytes.`}
              </li>
            ))}
          </ul>
          {inventory.executionCopyLinks && (
            <p>
              Check copy names:{" "}
              {inventory.executionCopyLinks.status === "missing"
                ? "No local check copies found."
                : inventory.executionCopyLinks.status === "unavailable"
                  ? "Unavailable to classify."
                  : inventory.executionCopyLinks.status === "partial"
                    ? `At least ${inventory.executionCopyLinks.matchingSavedRuns} ${inventory.executionCopyLinks.matchingSavedRuns === 1 ? "name matches" : "names match"} a saved run. The remaining names are not fully classified.`
                    : `${inventory.executionCopyLinks.matchingSavedRuns} match saved runs; ${inventory.executionCopyLinks.unassigned} are legacy or unassigned.`}
            </p>
          )}
          <p className="muted">
            A name match does not prove that a copy is safe to remove.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
