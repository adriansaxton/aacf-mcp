// The MCP server: eight read-only tools and one prompt over the AACF data. A fresh server is built per request
// (the handler is stateless), which is cheap: registration only, the data is already loaded.

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as aacf from "./aacf.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const INSTRUCTIONS =
  "Read-only access to the AI Adoption Controls Framework (AACF): controls for organisations adopting AI, their " +
  "Level 3 criteria, and cross-references to standards such as ISO/IEC 42001, the NIST AI RMF and the EU AI Act. " +
  "Start with get_framework_info. Cross-references are coverage, not a compliance finding. For a self-assessment, " +
  "use the self_assessment prompt: questions and rules come from this server, answers stay with the user. Cite " +
  "results with the attribution in each result's cite field (CC BY-SA 4.0).";

/** Run a query and return it as MCP tool output; a LookupError becomes a tool error the model can act on. */
function respond(run: () => unknown) {
  try {
    const result = run();
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  } catch (e) {
    if (e instanceof aacf.LookupError) return { isError: true, content: [{ type: "text" as const, text: e.message }] };
    throw e;
  }
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "aacf", title: "AI Adoption Controls Framework", version: aacf.data.release.framework_version },
    {
      instructions: INSTRUCTIONS,
      // The data only changes with an AACF release, which means a new deployment.
      cacheHints: { "tools/list": { ttlMs: ONE_DAY_MS, cacheScope: "public" },
                    "prompts/list": { ttlMs: ONE_DAY_MS, cacheScope: "public" },
                    "server/discover": { ttlMs: ONE_DAY_MS, cacheScope: "public" } },
    },
  );

  server.registerTool("get_framework_info", {
    title: "Framework overview",
    description: "Version, scale, overlays, owner roles, lifecycle stages, the cross-referenced standards and how to " +
      "cite AACF. Call this first.",
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => respond(() => aacf.frameworkInfo()));

  server.registerTool("list_domains", {
    title: "List domains and controls",
    description: "Every domain with its summary and the ID and title of each control in it.",
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => respond(() => aacf.listDomains()));

  server.registerTool("get_control", {
    title: "Get a control",
    description: "One control in full: objective, rationale, level descriptors 1 to 5, Level 3 criteria (with the " +
      "overlays they apply to), questions, evidence, guidance, owners, dependencies and cross-references.",
    inputSchema: z.object({ id: z.string().describe("Control ID, for example GOV-01 or SEC-03") }),
    annotations: READ_ONLY,
  }, async ({ id }) => respond(() => aacf.getControl(id)));

  server.registerTool("search_controls", {
    title: "Search controls",
    description: "Find controls by words in their title, objective, rationale, criteria or questions, optionally " +
      "filtered by domain, overlay, owner role or lifecycle stage. Returns summaries; use get_control for detail.",
    inputSchema: z.object({
      text: z.string().optional().describe("Words that must all appear, for example 'human oversight'"),
      domain: z.string().optional().describe("Domain code or name, for example GOV or Governance"),
      overlay: z.string().optional().describe("Overlay code: PUB, PRV, HIR, GEN, AGT or BLD"),
      owner_role: z.string().optional().describe("Owner role key, for example ai_governance_lead"),
      lifecycle_stage: z.string().optional().describe("Lifecycle stage key, for example deploy"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)"),
    }),
    annotations: READ_ONLY,
  }, async (args) => respond(() => aacf.searchControls(args)));

  server.registerTool("get_mapping", {
    title: "Which controls cover a standard's item",
    description: "Reverse lookup: the controls that address an item of a standard, with strength (direct or " +
      "partial) and confidence. A ref that is a prefix (for example 6.1) returns every item under it.",
    inputSchema: z.object({
      standard: z.string().describe("Standard key or name, for example ISO42001, 'ISO/IEC 42001', EUAIA, OWASPLLM"),
      ref: z.string().describe("Item in that standard, for example 6.1.2, A.6.2.3, Art. 14 or LLM01:2026"),
    }),
    annotations: READ_ONLY,
  }, async ({ standard, ref }) => respond(() => aacf.getMapping(standard, ref)));

  server.registerTool("get_standard_coverage", {
    title: "Coverage of a standard",
    description: "Every cross-referenced item of one standard, the controls covering each, and summary counts.",
    inputSchema: z.object({ standard: z.string().describe("Standard key or name, for example NISTRMF") }),
    annotations: READ_ONLY,
  }, async ({ standard }) => respond(() => aacf.getStandardCoverage(standard)));

  server.registerTool("get_assessment_questions", {
    title: "Self-assessment questions",
    description: "Questions, evidence and the applicable Level 3 criteria for one domain (or a published profile), " +
      "for a self-assessment the user's own assistant runs. Pass the overlays that apply to the organisation. " +
      "Answers are never sent to this server. Call with no domain to list the domains.",
    inputSchema: z.object({
      domain: z.string().optional().describe("Domain code or name"),
      profile: z.string().optional().describe("A published profile, when available"),
      overlays: z.array(z.string()).optional().describe("Overlay codes that apply, for example ['PUB', 'GEN']"),
    }),
    annotations: READ_ONLY,
  }, async (args) => respond(() => aacf.assessmentQuestions(args)));

  server.registerTool("get_scoring_rules", {
    title: "Scoring rules",
    description: "The assessor rulebook: scope, statuses, how to place a level (Level 3 needs every applicable " +
      "criterion met; never round up), evidence, targets and how to report.",
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => respond(() => aacf.scoringRules()));

  server.registerPrompt("self_assessment", {
    title: "Run an AACF self-assessment",
    description: "Guides your assistant through a self-assessment against AACF, scored on your side.",
    argsSchema: z.object({
      domain: z.string().optional().describe("Start with this domain (code or name); otherwise ask the user"),
    }),
  }, ({ domain }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "Run a self-assessment against the AI Adoption Controls Framework (AACF) with me, using the aacf tools.",
          "",
          "1. Call get_scoring_rules and follow the rulebook throughout.",
          "2. Agree the scope with me (which parts of the organisation and which uses of AI), then decide with me " +
          "which overlays apply (call get_framework_info for their meanings), with a one-line reason each.",
          `3. ${domain ? `Start with the ${domain} domain.` : "Ask me which domain to start with."} Call ` +
          "get_assessment_questions with that domain and the agreed overlays. Go through one control at a time: ask " +
          "the questions, ask what evidence exists, and record each applicable Level 3 criterion as met, not met or " +
          "not evidenced.",
          "4. Place each control's level by the rulebook: Level 3 only when every applicable criterion is met, never " +
          "round up, and 'we don't know' is insufficient evidence, not 0. Record confidence.",
          "5. After each domain, summarise: the distribution of levels, the share at the Level 3 baseline, and the " +
          "gaps, with the criteria IDs still outstanding.",
          "",
          "Keep my answers in this conversation only. Do not send them to any tool: the aacf server needs none of " +
          "them and stores nothing. This is a self-assessment against a framework, not a certification or a legal " +
          "compliance opinion.",
        ].join("\n"),
      },
    }],
  }));

  return server;
}
