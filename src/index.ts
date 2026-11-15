// Cloudflare Worker entry: the AACF MCP server at /mcp on aacf.adriansaxton.com.
//
// Requests without an Origin header (MCP clients calling from their own servers) are accepted. A request that carries
// an Origin must come from one of ALLOWED_ORIGIN_HOSTS, or it gets 403 (MCP spec 2026-07-28, Origin validation).
// Nothing is stored and no tool argument is logged.

import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server.js";

export const ROUTE = "/mcp";
export const ALLOWED_HOSTS = ["aacf.adriansaxton.com", "localhost", "127.0.0.1"];
export const ALLOWED_ORIGIN_HOSTS = ["aacf.adriansaxton.com"];

export const handler = createMcpHandler(createServer, {
  route: ROUTE,
  allowedHostnames: ALLOWED_HOSTS,
  allowedOriginHostnames: ALLOWED_ORIGIN_HOSTS,
  corsOptions: {
    origin: "https://aacf.adriansaxton.com",
    methods: "POST, OPTIONS",
    headers: "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    exposeHeaders: "",
    maxAge: 86400,
  },
  // responseMode stays "auto": the tools send no mid-call notifications, so every reply is a single JSON body.
});

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    return handler(request, env, ctx);
  },
};
