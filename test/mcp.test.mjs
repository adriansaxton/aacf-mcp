// End-to-end: a real MCP client (the official SDK, both protocol eras) talks to the Worker's handler through an
// in-process fetch. Covers tool and prompt listing (all must appear: the zod 4 check), every tool, errors,
// and the HTTP rules: route, methods, Origin and Host checks, and the 2026-07-28 header validation.
//
// Run with `npm test` (it bundles src/ to .test-build/worker.mjs first).

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const URL_MCP = "https://aacf.adriansaxton.com/mcp";
const TOOLS = ["get_framework_info", "list_domains", "get_control", "search_controls", "get_mapping",
               "get_standard_coverage", "get_assessment_questions", "get_scoring_rules"];
let worker;

before(async () => { worker = await import("../.test-build/worker.mjs"); });

// On Cloudflare every request carries a Host header; Node's Request does not add one, so add it as the edge would.
const call = (req) => {
  if (!req.headers.has("host")) {
    const headers = new Headers(req.headers);
    headers.set("host", new URL(req.url).host);
    req = new Request(req, { headers });
  }
  return worker.default.fetch(req, {}, { waitUntil() {}, passThroughOnException() {}, props: {} });
};
const inProcessFetch = (url, init) => call(new Request(url, init));

async function connect(era) {
  const client = new Client({ name: "aacf-mcp-test", version: "0.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch: inProcessFetch }));
  return client;
}

const json = (result) => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};

for (const era of ["modern", "legacy"]) {
  describe(`${era} client`, () => {
    let client;
    before(async () => { client = await connect(era); });

    test("lists all eight tools and the prompt", async () => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
      for (const t of tools) {
        assert.equal(t.annotations?.readOnlyHint, true, `${t.name} read-only`);
        assert.equal(t.inputSchema?.type, "object", `${t.name} has an input schema`);
      }
      const { prompts } = await client.listPrompts();
      assert.deepEqual(prompts.map((p) => p.name), ["self_assessment"]);
    });

    test("get_framework_info carries version and citation", async () => {
      const info = json(await client.callTool({ name: "get_framework_info", arguments: {} }));
      assert.equal(info.controls, 93);
      assert.equal(info.cite.licence.startsWith("CC BY-SA 4.0"), true);
      assert.equal(info.standards.AICM, undefined);
    });

    test("get_control returns the full record with cross-references", async () => {
      const c = json(await client.callTool({ name: "get_control", arguments: { id: "gov-01" } }));
      assert.equal(c.id, "GOV-01");
      assert.ok(c.criteria.length > 0 && c.cross_references.length > 0);
      assert.equal(c.url, "https://aacf.adriansaxton.com/controls/gov-01/");
    });

    test("get_mapping answers the reverse lookup, exact and by prefix", async () => {
      const exact = json(await client.callTool({ name: "get_mapping",
        arguments: { standard: "ISO/IEC 42001", ref: "clause 6.1.2" } }));
      assert.equal(exact.match, "exact");
      assert.ok(exact.items[0].controls.some((c) => c.id === "RSK-02"));
      const prefix = json(await client.callTool({ name: "get_mapping", arguments: { standard: "ISO42001", ref: "6.1" } }));
      assert.equal(prefix.match, "prefix");
      assert.ok(prefix.items.length > 1);
    });

    test("search_controls filters and ranks", async () => {
      const r = json(await client.callTool({ name: "search_controls",
        arguments: { text: "human oversight", limit: 5 } }));
      assert.ok(r.total >= 1 && r.controls.length <= 5);
      const agt = json(await client.callTool({ name: "search_controls", arguments: { overlay: "agt" } }));
      assert.ok(agt.total >= 1);
    });

    test("coverage, assessment questions and scoring rules", async () => {
      const cov = json(await client.callTool({ name: "get_standard_coverage", arguments: { standard: "owaspllm" } }));
      assert.equal(cov.items.length, cov.summary.items);
      const q = json(await client.callTool({ name: "get_assessment_questions",
        arguments: { domain: "Governance", overlays: ["PUB"] } }));
      assert.equal(q.domain, "GOV");
      assert.ok(q.controls.every((c) => Array.isArray(c.level_3_criteria)));
      const rules = json(await client.callTool({ name: "get_scoring_rules", arguments: {} }));
      assert.match(rules.rulebook, /Never round up/);
    });

    test("caller mistakes come back as tool errors with a way forward", async () => {
      const bad = await client.callTool({ name: "get_control", arguments: { id: "XYZ-99" } });
      assert.equal(bad.isError, true);
      assert.match(bad.content[0].text, /search_controls/);
      const std = await client.callTool({ name: "get_mapping", arguments: { standard: "nope", ref: "1" } });
      assert.equal(std.isError, true);
      assert.match(std.content[0].text, /ISO42001/);
    });

    test("the self_assessment prompt keeps answers client-side", async () => {
      const p = await client.getPrompt({ name: "self_assessment", arguments: { domain: "GOV" } });
      assert.match(p.messages[0].content.text, /Start with the GOV domain/);
      assert.match(p.messages[0].content.text, /Do not send them to any tool/);
    });
  });
}

describe("HTTP rules", () => {
  const modernBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list",
    params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } });
  const post = (headers = {}, body = modernBody, url = URL_MCP) => call(new Request(url, { method: "POST", body,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers } }));

  test("only /mcp is served", async () => {
    assert.equal((await post({}, modernBody, "https://aacf.adriansaxton.com/other")).status, 404);
  });

  test("GET and DELETE get 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      assert.equal((await call(new Request(URL_MCP, { method }))).status, 405, method);
    }
  });

  test("a foreign Origin gets 403; the AACF site's Origin and no Origin are accepted", async () => {
    assert.equal((await post({ Origin: "https://evil.example" })).status, 403);
    const ok = { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" };
    assert.notEqual((await post({ ...ok, Origin: "https://aacf.adriansaxton.com" })).status, 403);
    assert.notEqual((await post(ok)).status, 403);
  });

  test("a foreign Host is refused", async () => {
    const r = await call(new Request("https://evil.example/mcp", { method: "POST", body: modernBody,
      headers: { "Content-Type": "application/json" } }));
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
  });

  test("2026-07-28 requests without Mcp-Method are rejected with 400", async () => {
    const r = await post({ "MCP-Protocol-Version": "2026-07-28" });
    assert.equal(r.status, 400);
  });

  test("CORS allows only the AACF site", async () => {
    const r = await post({ "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" });
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://aacf.adriansaxton.com");
  });
});
