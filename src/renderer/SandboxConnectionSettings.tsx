import { useEffect, useState, type FormEvent } from "react";
import type { DesktopAPI } from "../shared/contracts";
import type { CloudImage, CloudSession } from "../shared/cloud";
import { CheckCircle2, Search } from "lucide-react";

export function SandboxConnectionSettings({ api }: { api: DesktopAPI }) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [projectId, setProjectId] = useState("");
  const [key, setKey] = useState("");
  const [images, setImages] = useState<CloudImage[] | null>(null);
  const [imageQuery, setImageQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .cloudSession()
      .then((value) => {
        if (!active) return;
        setSession(value);
        setProjectId(value.projectId);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not read Sandbox settings. Reopen Settings and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setImages(null);
    try {
      const next = await api.configureCloud({
        key,
        projectId: projectId.trim(),
      });
      setSession(next);
      setProjectId(next.projectId);
      setKey("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not configure Sandbox access. Check the key and project ID.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkAccess() {
    setBusy(true);
    setError("");
    setImages(null);
    try {
      const catalog = await api.cloudImages("");
      setImages(catalog.images);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} Check that this project has Sandbox access and that the key belongs to it.`
          : "Sandbox access could not be checked. Check project access and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-label="Sandbox connection">
      <h2>Nebius Sandboxes</h2>
      <p>
        Use a Token Factory API key from the project that will run Sandboxes.
        The key stays in this app session and is not saved in the workspace
        database.
      </p>
      {session?.configured && (
        <div className="settings-save-banner" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            <strong>Sandbox connection saved</strong>
            <br />
            Project {session.projectId}. Check access to verify the available
            images.
          </span>
        </div>
      )}
      <form
        className="sandbox-connection-form"
        onSubmit={(event) => void configure(event)}
      >
        <label>
          Sandbox project ID
          <input
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label>
          Sandbox API key
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <div className="sandbox-connection-actions">
          <button className="primary" type="submit" disabled={busy}>
            Use for this app session
          </button>
          {session?.configured && (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void checkAccess()}
            >
              Check Sandbox access
            </button>
          )}
        </div>
      </form>
      {images && (
        <div className="sandbox-images" role="status">
          {images.length ? (
            <details>
              <summary>
                Available images <span>{images.length}</span>
              </summary>
              <p>
                Teammates use images that contain the tools needed for their
                assignments. Scully verifies an image before starting that
                teammate.
              </p>
              <label className="sandbox-image-search">
                <Search size={16} aria-hidden="true" /> Filter images
                <input
                  value={imageQuery}
                  onChange={(event) => setImageQuery(event.target.value)}
                  placeholder="Search image names"
                />
              </label>
              <ul>
                {images
                  .filter((image) =>
                    image.tag.toLowerCase().includes(imageQuery.toLowerCase()),
                  )
                  .map((image) => (
                    <li key={image.uuid}>
                      <span>{image.tag}</span>
                    </li>
                  ))}
              </ul>
            </details>
          ) : (
            <p>
              No Sandbox images were returned. Check project activation or
              contact Nebius support.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
