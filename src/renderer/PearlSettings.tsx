import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, CircleCheck, Info, PlugZap, Sparkles } from "lucide-react";
import type { DesktopAPI } from "../shared/contracts";
import type { ModelOption, SessionInfo } from "../shared/runs";
import { ModelPicker } from "./ModelPicker";
import type { RemoteMcpInfo } from "../shared/pearl-chat";

const quickModels: ModelOption[] = [
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    name: "Qwen3 235B Instruct",
  },
  { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super" },
  { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
];
const initialModel = quickModels[0].id;

export function PearlSettings({
  api,
  onBack,
  onSessionChange,
}: {
  api: DesktopAPI;
  onBack: () => void;
  onSessionChange: (info: SessionInfo) => void;
}) {
  const [section, setSection] = useState<"models" | "connections">("models");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [model, setModel] = useState(initialModel);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackModel, setFallbackModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>(quickModels);
  const [catalogStatus, setCatalogStatus] = useState<
    "loading" | "ready" | "unavailable" | "disconnected"
  >("disconnected");
  const [key, setKey] = useState("");
  const [webKey, setWebKey] = useState("");
  const [webConfigured, setWebConfigured] = useState(false);
  const [mcp, setMcp] = useState<RemoteMcpInfo>({
    connected: false,
    tools: [],
  });
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [sandboxConfigured, setSandboxConfigured] = useState(false);
  const [sandboxProjectId, setSandboxProjectId] = useState("");
  const [sandboxKey, setSandboxKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadModels(active = () => true) {
    setCatalogStatus("loading");
    try {
      if (!api.listPearlModels) throw new Error("Model catalog unavailable");
      const available = await api.listPearlModels();
      if (!active()) return;
      setModels(available);
      setCatalogStatus("ready");
    } catch {
      if (active()) setCatalogStatus("unavailable");
    }
  }

  useEffect(() => {
    let live = true;
    void Promise.all([
      api.session(),
      api.webSearchInfo?.() ?? Promise.resolve({ configured: false }),
      api.remoteMcpInfo?.() ?? Promise.resolve({ connected: false, tools: [] }),
      api.pearlSandboxConnection?.() ??
        Promise.resolve({ configured: false, projectId: "" }),
    ])
      .then(([info, web, remote, sandbox]) => {
        if (!live) return;
        setSession(info);
        setWebConfigured(web.configured);
        setMcp(remote);
        setSandboxConfigured(sandbox.configured);
        setSandboxProjectId(sandbox.projectId);
        if (info.model) setModel(info.model);
        if (info.fallbackModel) {
          setFallbackEnabled(true);
          setFallbackModel(info.fallbackModel);
        }
        if (info.configured) void loadModels(() => live);
      })
      .catch(() => {
        if (live) setError("Could not load connection settings.");
      });
    return () => {
      live = false;
    };
  }, [api]);

  async function act(work: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectMcp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      if (!api.connectRemoteMcp) throw new Error("Remote MCP is unavailable");
      try {
        const connected = await api.connectRemoteMcp(mcpEndpoint, mcpToken);
        setMcp(connected);
        setMcpToken("");
        setNotice(`Remote MCP connected with ${connected.tools.length} tools.`);
      } finally {
        if (api.remoteMcpInfo) setMcp(await api.remoteMcpInfo());
      }
    });
  }

  function selection() {
    if (!model) throw new Error("Choose a primary model.");
    if (fallbackEnabled && (!fallbackModel || fallbackModel === model))
      throw new Error(
        "Choose a different fallback model, or turn fallback off.",
      );
    return { model, ...(fallbackEnabled ? { fallbackModel } : {}) };
  }

  async function saveModels() {
    await act(async () => {
      if (!api.selectPearlModels)
        throw new Error("Model selection unavailable");
      const updated = await api.selectPearlModels(selection());
      setSession(updated);
      onSessionChange(updated);
      setNotice(
        "Model choice saved. New turns use the selected primary model.",
      );
    });
  }

  async function connectNebius(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      const updated = await api.configureSession({
        key,
        ...selection(),
        outputTokens: session?.configured ? session.outputTokens : 16384,
      });
      setSession(updated);
      onSessionChange(updated);
      setKey("");
      setNotice(
        "Nebius key saved for this app session. New turns use the selected model.",
      );
      void loadModels();
    });
  }

  async function connectWeb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      const status = await api.configureWebSearch(webKey);
      setWebConfigured(status.configured);
      setWebKey("");
      setNotice("Web search connected for this app session.");
    });
  }

  const modelChoices = catalogStatus === "ready" ? models : quickModels;
  const fallbackChoices = modelChoices.filter((option) => option.id !== model);

  return (
    <main className="pearl-settings-page" id="pearl-settings-page">
      <div className="pearl-settings-scroll">
        <div className="pearl-settings-inner">
          <button className="pearl-settings-back" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to Room
          </button>
          <header className="pearl-settings-heading">
            <span>YOUR WORKSPACE, YOUR RULES</span>
            <h1>Settings</h1>
            <p>Choose Pearl’s model and manage the connections she uses.</p>
          </header>
          <nav className="pearl-settings-tabs" aria-label="Settings sections">
            <button
              className={section === "models" ? "active" : ""}
              aria-current={section === "models" ? "page" : undefined}
              onClick={() => setSection("models")}
            >
              <Sparkles size={17} aria-hidden="true" /> Models
            </button>
            <button
              className={section === "connections" ? "active" : ""}
              aria-current={section === "connections" ? "page" : undefined}
              onClick={() => setSection("connections")}
            >
              <PlugZap size={17} aria-hidden="true" /> App & connection
            </button>
          </nav>
          {error && (
            <p className="pearl-settings-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="pearl-settings-notice" role="status">
              {notice}
            </p>
          )}
          {section === "models" && (
            <section className="pearl-settings-card" aria-label="Pearl models">
              <h2>Pearl’s model</h2>
              <p>
                Choose the primary model directly to avoid waiting for another
                model’s fallback deadline. Model changes apply to new turns;
                work already running keeps its current model.
              </p>
              <div className="pearl-model-row">
                <div>
                  <strong>Primary model</strong>
                  <small>
                    Pearl uses this model for chat and coding actions.
                  </small>
                </div>
                <ModelPicker
                  label="Primary model"
                  value={model}
                  options={modelChoices}
                  onChange={setModel}
                  disabled={busy}
                  catalogStatus={catalogStatus}
                  onRetry={() => void loadModels()}
                  recommendedIds={[initialModel]}
                />
              </div>
              <label className="pearl-fallback-toggle">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(event) => setFallbackEnabled(event.target.checked)}
                />
                Use a fallback if the selected model does not respond
              </label>
              {fallbackEnabled && (
                <div className="pearl-model-row">
                  <div>
                    <strong>Fallback model</strong>
                    <small>Must differ from the primary model.</small>
                  </div>
                  <ModelPicker
                    label="Fallback model"
                    value={fallbackModel}
                    options={fallbackChoices}
                    onChange={setFallbackModel}
                    disabled={busy}
                    catalogStatus={catalogStatus}
                    onRetry={() => void loadModels()}
                    recommendedIds={[]}
                  />
                </div>
              )}
              <p className="pearl-settings-hint">
                {catalogStatus === "ready"
                  ? `${models.length} models are listed for this account. A listing does not verify response speed or tool quality.`
                  : catalogStatus === "unavailable"
                    ? "The Nebius model list could not be loaded. Suggested models are shown; their availability is unverified."
                    : session?.configured
                      ? "Loading models for this Nebius account."
                      : "Connect Nebius to browse the models available to your account. Suggested models are shown for setup."}
              </p>
              {session?.configured ? (
                <button
                  className="pearl-settings-primary"
                  disabled={busy}
                  onClick={() => void saveModels()}
                >
                  Save model choice
                </button>
              ) : (
                <button
                  className="pearl-settings-primary"
                  onClick={() => setSection("connections")}
                >
                  Connect Nebius to save
                </button>
              )}
            </section>
          )}
          {section === "connections" && (
            <>
              <section
                className="pearl-settings-card"
                aria-label="Nebius Sandbox connection"
              >
                <h2>Nebius Sandbox</h2>
                <div
                  className={`pearl-connection-status ${sandboxConfigured ? "connected" : ""}`}
                  role="status"
                >
                  {sandboxConfigured ? (
                    <CircleCheck size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                  <div>
                    <strong>
                      {sandboxConfigured
                        ? "Sandbox connection saved for this session"
                        : "Sandbox not connected"}
                    </strong>
                    <p>
                      {sandboxConfigured
                        ? "Project files are uploaded only after you review the transfer."
                        : "Connect a Sandbox project to prepare a remote workspace."}
                    </p>
                  </div>
                </div>
                <p>
                  {sandboxConfigured
                    ? "Connected for this app session."
                    : "Connect Sandbox to run Pearl tasks in remote checkpoints."}{" "}
                  Source files are uploaded only after a separate task review.
                  The key stays in memory until Scully closes.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      const connection = await api.configurePearlSandbox(
                        sandboxKey,
                        sandboxProjectId,
                      );
                      setSandboxConfigured(connection.configured);
                      setSandboxProjectId(connection.projectId);
                      setSandboxKey("");
                    });
                  }}
                >
                  <label>
                    Sandbox project ID
                    <input
                      value={sandboxProjectId}
                      onChange={(event) =>
                        setSandboxProjectId(event.target.value)
                      }
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Sandbox API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={sandboxKey}
                      onChange={(event) => setSandboxKey(event.target.value)}
                      required
                      maxLength={4096}
                    />
                  </label>
                  <button className="pearl-settings-primary" disabled={busy}>
                    Connect Sandbox
                  </button>
                </form>
              </section>
              <section
                className="pearl-settings-card"
                aria-label="Nebius connection"
              >
                <h2>Nebius connection</h2>
                <div
                  className={`pearl-connection-status ${session?.configured ? "connected" : ""}`}
                  role="status"
                >
                  {session?.configured ? (
                    <CircleCheck size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                  <div>
                    <strong>
                      {session?.configured
                        ? "Key saved for this session"
                        : "Connection not set up"}
                    </strong>
                    <p>
                      {session?.configured
                        ? "Saving the key did not test model availability. Pearl uses the selected model on the next turn."
                        : "Enter a Nebius key to chat and code with Pearl."}
                    </p>
                  </div>
                </div>
                <form onSubmit={(event) => void connectNebius(event)}>
                  <label>
                    Nebius API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      required
                      minLength={8}
                      maxLength={4096}
                    />
                  </label>
                  <p className="pearl-settings-hint">
                    The key stays in memory until Scully closes. Re-enter a key
                    here only to connect or replace it. Change models on the
                    Models tab without re-entering it.
                  </p>
                  <button className="pearl-settings-primary" disabled={busy}>
                    {" "}
                    {session?.configured
                      ? "Replace Nebius key"
                      : "Connect Nebius"}
                  </button>
                </form>
              </section>
              <section
                className="pearl-settings-card"
                aria-label="Web search connection"
              >
                <h2>Web search</h2>
                <div
                  className={`pearl-connection-status ${webConfigured ? "connected" : ""}`}
                  role="status"
                >
                  {webConfigured ? (
                    <CircleCheck size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                  <div>
                    <strong>
                      {webConfigured
                        ? "Tavily connected for this session"
                        : "Web search not connected"}
                    </strong>
                    <p>
                      Pearl can search public web sources when a Tavily key is
                      connected.
                    </p>
                  </div>
                </div>
                <p>
                  Pearl may send short search queries and selected public result
                  URLs to Tavily. Search results are saved in the chat. The key
                  stays in memory until Scully closes.
                </p>
                <form onSubmit={(event) => void connectWeb(event)}>
                  <label>
                    Tavily API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={webKey}
                      onChange={(event) => setWebKey(event.target.value)}
                      required
                    />
                  </label>
                  <div className="pearl-settings-actions">
                    <button className="pearl-settings-primary" disabled={busy}>
                      Connect web search
                    </button>
                    {webConfigured && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const status = await api.disconnectWebSearch();
                            setWebConfigured(status.configured);
                            setNotice("Web search disconnected.");
                          })
                        }
                      >
                        Disconnect web search
                      </button>
                    )}
                  </div>
                </form>
              </section>
              <section
                className="pearl-settings-card"
                aria-label="Remote MCP connection"
              >
                <h2>Remote MCP</h2>
                <div
                  className={`pearl-connection-status ${mcp.connected ? "connected" : ""}`}
                  role="status"
                >
                  {mcp.connected ? (
                    <CircleCheck size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                  <div>
                    <strong>
                      {mcp.connected
                        ? "Connected for this session"
                        : "No remote server connected"}
                    </strong>
                    <p>
                      {mcp.connected
                        ? `${mcp.endpoint} offers ${mcp.tools.length} tools.`
                        : "Connect one HTTPS Streamable HTTP server. Pearl will ask before every remote tool call."}
                    </p>
                  </div>
                </div>
                <p>
                  Tool names and descriptions come from the server. Review the
                  endpoint and each tool call before approving it. Call
                  arguments go to the server; discovered tool details and
                  results enter Pearl's chat context and are sent to the
                  selected Nebius model. The optional bearer token stays in
                  memory until Scully closes.
                </p>
                <form onSubmit={(event) => void connectMcp(event)}>
                  <label>
                    Server endpoint
                    <input
                      type="url"
                      value={mcpEndpoint}
                      onChange={(event) => setMcpEndpoint(event.target.value)}
                      placeholder="https://example.com/mcp"
                      required
                      maxLength={2048}
                    />
                  </label>
                  <label>
                    Bearer token (optional)
                    <input
                      type="password"
                      autoComplete="off"
                      value={mcpToken}
                      onChange={(event) => setMcpToken(event.target.value)}
                      maxLength={4096}
                    />
                  </label>
                  <div className="pearl-settings-actions">
                    <button className="pearl-settings-primary" disabled={busy}>
                      Connect remote server
                    </button>
                    {mcp.connected && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            if (!api.disconnectRemoteMcp)
                              throw new Error("Remote MCP is unavailable");
                            setMcp(await api.disconnectRemoteMcp());
                            setNotice("Remote MCP disconnected.");
                          })
                        }
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </form>
                {mcp.connected && (
                  <details>
                    <summary>Available tools ({mcp.tools.length})</summary>
                    <ul>
                      {mcp.tools.map((tool) => (
                        <li key={tool.name}>
                          <strong>{tool.name}</strong>:{" "}
                          {tool.description || "No description supplied"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
              <section
                className="pearl-settings-card"
                aria-label="Execution permissions"
              >
                <h2>Execution & permissions</h2>
                <p>
                  Project access and commands require separate approval in the
                  Room. File changes use revision checks and reviewable diffs.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
