# AACF MCP server

A public, read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the
[AI Adoption Controls Framework](https://aacf.adriansaxton.com) (AACF). Point any MCP-capable AI assistant at it to
look up controls, criteria and cross-references, for example "which controls cover ISO/IEC 42001 clause 6.1.2".
It serves the published release data and stores nothing.

Work in progress: the server is built and tested locally; it is not deployed yet.

## Tools

| Tool | What it answers |
|---|---|
| `get_framework_info` | Version, scale, overlays, owner roles, lifecycle stages, the standards cross-referenced, how to cite |
| `list_domains` | Every domain and the controls in it |
| `get_control` | One control in full, with its Level 3 criteria and cross-references |
| `search_controls` | Controls by words, domain, overlay, owner role or lifecycle stage |
| `get_mapping` | Which controls cover an item of a standard, for example ISO/IEC 42001 6.1.2 |
| `get_standard_coverage` | Every cross-referenced item of one standard |
| `get_assessment_questions` | Questions, evidence and applicable criteria for a self-assessment, one domain at a time |
| `get_scoring_rules` | The assessor rulebook |

The `self_assessment` prompt guides your assistant through an assessment. Your answers stay in your conversation:
no tool accepts them, and the server stores nothing.

Cross-references are coverage, not a compliance finding.

## How the data gets in

1. `npm run vendor -- v1.2.1` copies one tagged AACF release (`data/aacf.json`, `data/aacf.schema.json`,
   `framework/rulebook.md`) into `vendor/aacf/` and records a SHA-256 for each file in `vendor/aacf/RELEASE.json`.
2. `npm run build:data` checks the files against those hashes and against the release's own JSON Schema, refuses any
   data shape other than schema major version 1, checks every cross-reference, dependency and owner, and writes a
   compact, pre-indexed `src/data/aacf.generated.json` for the server to read.
3. `npm test` checks that nothing is lost or changed on the way: every control field, every cross-reference in both
   directions, and the coverage counts.

To move to a new AACF release, vendor its tag, rebuild and run the tests.

## Server and tests

`src/index.ts` is the Cloudflare Worker: the MCP endpoint is `/mcp`, built on the official MCP TypeScript SDK through
`createMcpHandler`. It speaks the 2026-07-28 protocol and still serves 2025 Streamable HTTP clients. Requests that
carry an `Origin` header must come from the AACF website; requests without one (MCP clients calling from their own
servers) are accepted.

`npm test` builds the data, bundles the Worker and runs a real MCP client against it in both protocol versions:
every tool and the prompt must be listed and must answer, and the HTTP rules (route, methods, Origin, Host and
the 2026-07-28 header checks) are tested directly. `npm run typecheck` runs TypeScript.

Wrangler, used to run and deploy the Worker, needs Node.js 22.12 or later (`.node-version` pins 22).

## Deployment

Cloudflare Workers Builds deploys the `main` branch: build command `npm run build:data`, deploy command
`npx wrangler deploy` (the default). The Worker name in Cloudflare must be `aacf-mcp`, matching `wrangler.jsonc`.

## Licences

The code in this repository is under the MIT licence (`LICENSE`). The framework content in `vendor/aacf/` and
everything the server returns from it is the AI Adoption Controls Framework by Adrian Saxton, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Cite it with the DOI 10.5281/zenodo.24171718.
The AACF name and logo are not openly licensed.
