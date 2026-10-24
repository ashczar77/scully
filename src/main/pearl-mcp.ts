import { randomUUID } from "node:crypto";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import type { RemoteMcpInfo } from "../shared/pearl-chat";

export type RemoteMcpTool = {
  name: string;
  description: string;
  inputSchema: object;
};

const MAX_TOOLS = 40;
const MAX_ARGUMENTS = 16_000;
const MAX_RESULT = 24_000;
const MAX_SCHEMA = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function publicDnsAnswer(
  addresses: { address: string; family: number }[],
  all: boolean,
): string | { address: string; family: number }[] {
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new Error("MCP endpoint resolved to a non-public address");
  return all ? addresses : addresses[0].address;
}

export function validateRemoteMcpEndpoint(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Enter a valid HTTPS MCP endpoint");
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Enter a valid HTTPS MCP endpoint");
  }
  const host = endpoint.hostname.toLowerCase();
  if (
    endpoint.protocol !== "https:" ||
    endpoint.port !== "" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    isIP(host)
  )
    throw new Error(
      "Use a public HTTPS endpoint without URL credentials, query, or custom port",
    );
  return endpoint;
}

function safeTool(value: RemoteMcpTool): RemoteMcpTool {
  if (!/^[a-zA-Z0-9_.\/-]{1,100}$/.test(value.name))
    throw new Error("MCP server returned an invalid tool name");
  const schema = JSON.stringify(value.inputSchema);
  if (!schema || schema.length > MAX_SCHEMA)
    throw new Error("MCP server returned a tool schema that is too large");
  return {
    name: value.name,
    description: String(value.description || "").slice(0, 1200),
    inputSchema: value.inputSchema,
  };
}

/** A single session-only remote MCP connection. Server content is always untrusted. */
export class RemoteMcpConnection {
  constructor(
    private readonly networkFetch: typeof undiciFetch = undiciFetch,
  ) {}
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private agent?: Agent;
  private state: RemoteMcpInfo = { connected: false, tools: [] };
  private generation = 0;

  info(): RemoteMcpInfo {
    return structuredClone(this.state);
  }

  async connect(value: unknown, token: unknown): Promise<RemoteMcpInfo> {
    const endpoint = validateRemoteMcpEndpoint(value);
    if (
      typeof token !== "string" ||
      token.length > 4096 ||
      /[\r\n]/.test(token)
    )
      throw new Error("Invalid bearer token");
    await this.disconnect();
    const generation = this.generation;
    const agent = new Agent({
      connect: {
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, "", 0);
            try {
              const answer = publicDnsAnswer(addresses, Boolean(options.all));
              callback(
                null,
                answer as string,
                options.all ? 0 : addresses[0].family,
              );
            } catch (cause) {
              callback(cause as Error, "", 0);
            }
          });
        },
      },
    });
    const guardedFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const requested = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (requested.href !== endpoint.href)
        throw new Error("MCP request left its configured endpoint");
      const response = await this.networkFetch(requested.href, {
        ...init,
        redirect: "error",
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1]);
      if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES)
        throw new Error("MCP response is too large");
      if (!response.body) return response as unknown as Response;
      let size = 0;
      const bounded = (
        response.body as unknown as ReadableStream<Uint8Array>
      ).pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
              controller.error(new Error("MCP response is too large"));
              return;
            }
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(bounded, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }) as typeof fetch;
    const transport = new StreamableHTTPClientTransport(endpoint, {
      authProvider: token ? { token: async () => token } : undefined,
      redirectPolicy: "same-origin",
      requestInit: { redirect: "error" },
      fetch: guardedFetch,
    });
    const client = new Client(
      { name: "scully-pearl", version: "0.2.0" },
      { versionNegotiation: { mode: "auto" }, listMaxPages: 2 },
    );
    try {
      await client.connect(transport, { timeout: 10_000 });
      const listed = await client.listTools(undefined, { timeout: 10_000 });
      if (listed.tools.length > MAX_TOOLS)
        throw new Error("MCP server offers too many tools for this connection");
      const tools = listed.tools.map((tool) =>
        safeTool({
          name: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema,
        }),
      );
      if (generation !== this.generation)
        throw new Error("Connection was replaced");
      this.client = client;
      this.transport = transport;
      this.agent = agent;
      this.state = {
        connected: true,
        endpoint: endpoint.origin + endpoint.pathname,
        revision: randomUUID(),
        tools,
      };
      return this.info();
    } catch (error) {
      await client.close().catch(() => {});
      await agent.close();
      throw new Error(
        `MCP connection failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async disconnect(): Promise<RemoteMcpInfo> {
    this.generation++;
    this.state = { connected: false, tools: [] };
    const client = this.client;
    const agent = this.agent;
    this.client = undefined;
    this.transport = undefined;
    this.agent = undefined;
    await client?.close().catch(() => {});
    await agent?.close();
    return this.info();
  }

  validateCall(
    name: unknown,
    argumentsValue: unknown,
  ): {
    revision: string;
    name: string;
    arguments: Record<string, unknown>;
  } {
    if (!this.state.connected || !this.state.revision)
      throw new Error("Connect a remote MCP server in Settings first");
    if (
      typeof name !== "string" ||
      !this.state.tools.some((tool) => tool.name === name)
    )
      throw new Error("This MCP tool is no longer available");
    if (
      !argumentsValue ||
      typeof argumentsValue !== "object" ||
      Array.isArray(argumentsValue)
    )
      throw new Error("MCP tool arguments must be an object");
    const encoded = JSON.stringify(argumentsValue);
    if (!encoded || encoded.length > MAX_ARGUMENTS)
      throw new Error("MCP tool arguments are too large");
    return {
      revision: this.state.revision,
      name,
      arguments: JSON.parse(encoded),
    };
  }

  async call(
    approved: {
      revision: string;
      name: string;
      arguments: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.client || approved.revision !== this.state.revision)
      throw new Error("MCP connection changed; request a new approval");
    this.validateCall(approved.name, approved.arguments);
    const result = await this.client.callTool(
      { name: approved.name, arguments: approved.arguments },
      { timeout: 30_000, signal },
    );
    const output = JSON.stringify({
      isError: result.isError === true,
      content: result.content,
    });
    return output.length > MAX_RESULT
      ? JSON.stringify({
          isError: result.isError === true,
          truncated: true,
          contentPreview: output.slice(0, MAX_RESULT - 120),
        })
      : output;
  }
}
