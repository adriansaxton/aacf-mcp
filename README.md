# AACF MCP server

A public, read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the
[AI Adoption Controls Framework](https://aacf.adriansaxton.com) (AACF). Point any MCP-capable AI assistant at it to
look up controls, criteria and cross-references, for example "which controls cover ISO/IEC 42001 clause 6.1.2".
It serves the published release data and stores nothing.

Work in progress: the data build is done; the server itself is next.

## How the data gets in

1. `npm run vendor -- v1.2.1` copies one tagged AACF release (`data/aacf.json`, `data/aacf.schema.json`,
   `framework/rulebook.md`) into `vendor/aacf/` and records a SHA-256 for each file in `vendor/aacf/RELEASE.json`.
2. `npm run build:data` checks the files against those hashes and against the release's own JSON Schema, refuses any
   data shape other than schema major version 1, checks every cross-reference, dependency and owner, and writes a
   compact, pre-indexed `src/data/aacf.generated.json` for the server to read.
3. `npm test` checks that nothing is lost or changed on the way: every control field, every cross-reference in both
   directions, and the coverage counts.

To move to a new AACF release, vendor its tag, rebuild and run the tests.

## Licences

The code in this repository is under the MIT licence (`LICENSE`). The framework content in `vendor/aacf/` and
everything the server returns from it is the AI Adoption Controls Framework by Adrian Saxton, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Cite it with the DOI 10.5281/zenodo.24171718.
The AACF name and logo are not openly licensed.
