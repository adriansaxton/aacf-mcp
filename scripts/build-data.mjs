// Build src/data/aacf.generated.json: a compact, pre-indexed copy of the vendored AACF release.
//
// The Worker answers every tool call from this file without parsing or searching the full aacf.json, so each request
// stays well inside the Workers Free CPU limit (10 ms per request). The build refuses to run unless:
//   - the vendored files match the SHA-256 values in vendor/aacf/RELEASE.json;
//   - aacf.json passes its own published JSON Schema (aacf.schema.json);
//   - the data shape is schema major version 1, the version this server is written for;
//   - every cross-reference, dependency and owner points at something that exists.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

export const SUPPORTED_SCHEMA_MAJOR = 1;
// The all-versions DOI always resolves to the latest release; each version's own DOI is on its Zenodo record.
const DOI_ALL_VERSIONS = "10.5281/zenodo.24171718";
const SITE = "https://aacf.adriansaxton.com";
const REPO = "https://github.com/adriansaxton/AACF";
const LICENCE = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };

const VENDOR = new URL("../vendor/aacf/", import.meta.url);
const OUT = new URL("../src/data/aacf.generated.json", import.meta.url);

const fail = (msg) => { throw new Error(`build-data: ${msg}`); };

// Natural order for references such as 4.2, 4.10, A.6.2.3, LLM01:2026.
const naturalKey = (s) => s.split(/(\d+)/).map((p, i) => (i % 2 ? p.padStart(8, "0") : p)).join("");
export const byNatural = (a, b) => naturalKey(a).localeCompare(naturalKey(b));

export function compact(data, release, rulebook) {
  const { meta } = data;
  const major = Number(String(meta.schema_version).split(".")[0]);
  if (major !== SUPPORTED_SCHEMA_MAJOR) fail(`schema ${meta.schema_version} is not major ${SUPPORTED_SCHEMA_MAJOR}`);

  const controls = {};
  const domains = [];
  const refs = {};      // source -> ref -> label (each source item's label is stored once)
  const byRef = {};     // source -> ref -> [[control, strength, confidence], ...]
  const search = {};    // control -> lower-case text for search_controls

  for (const d of data.domains) {
    domains.push({ code: d.domain, name: d.name, summary: d.summary, note: meta.domains[d.domain]?.note,
                   controls: d.controls.map((c) => c.id) });
    for (const c of d.controls) {
      if (controls[c.id]) fail(`duplicate control ${c.id}`);
      const { mappings, ...rest } = c;
      controls[c.id] = { ...rest, domain: d.domain, mappings: mappings.map((m) => [m.source, m.ref, m.strength, m.confidence]) };
      for (const m of mappings) {
        if (!meta.sources[m.source]) fail(`${c.id}: unknown source ${m.source}`);
        const known = refs[m.source]?.[m.ref];
        if (known !== undefined && known !== m.label) fail(`${m.source} ${m.ref}: two different labels`);
        (refs[m.source] ??= {})[m.ref] = m.label;
        ((byRef[m.source] ??= {})[m.ref] ??= []).push([c.id, m.strength, m.confidence]);
      }
      search[c.id] = [c.id, c.title, c.objective, c.rationale, ...c.criteria.map((k) => k.text), ...c.questions]
        .join("\n").toLowerCase();
    }
  }

  for (const c of Object.values(controls)) {
    for (const dep of c.dependencies) if (!controls[dep]) fail(`${c.id}: depends on missing ${dep}`);
    if (c.replaced_by && !controls[c.replaced_by]) fail(`${c.id}: replaced_by missing ${c.replaced_by}`);
    if (!meta.owner_roles[c.owner.accountable]) fail(`${c.id}: unknown owner ${c.owner.accountable}`);
    for (const r of c.owner.contributors) if (!meta.owner_roles[r]) fail(`${c.id}: unknown contributor ${r}`);
    for (const s of c.lifecycle) if (!meta.lifecycle_stages[s]) fail(`${c.id}: unknown lifecycle stage ${s}`);
    for (const k of c.criteria) {
      if (k.applies !== "core") for (const o of k.applies) if (!meta.overlays[o]) fail(`${k.id}: unknown overlay ${o}`);
    }
  }

  // Sort references naturally, and work out each standard's coverage once.
  const coverage = {};
  for (const src of Object.keys(byRef)) {
    const sorted = Object.keys(byRef[src]).sort(byNatural);
    refs[src] = Object.fromEntries(sorted.map((r) => [r, refs[src][r]]));
    byRef[src] = Object.fromEntries(sorted.map((r) => [r, byRef[src][r]]));
    const items = Object.values(byRef[src]);
    coverage[src] = {
      items: items.length,
      items_direct: items.filter((hits) => hits.some((h) => h[1] === "direct")).length,
      items_partial_only: items.filter((hits) => hits.every((h) => h[1] === "partial")).length,
      controls: new Set(items.flat().map((h) => h[0])).size,
    };
  }

  return {
    release: { tag: release.tag, framework_version: meta.framework.version, schema_version: meta.schema_version,
               updated: meta.framework.updated },
    citation: { name: meta.framework.name, short_name: meta.framework.short_name, version: meta.framework.version,
                licence: LICENCE, doi_all_versions: DOI_ALL_VERSIONS, site: SITE, source: `${REPO}/tree/${release.tag}` },
    vocab: { scale: meta.scale, overlays: meta.overlays, owner_roles: meta.owner_roles,
             lifecycle_stages: meta.lifecycle_stages, applicability: meta.applicability, statuses: meta.statuses,
             sources: meta.sources },
    profiles: meta.profiles ?? {},
    domains, controls, refs, by_ref: byRef, coverage, search,
    rulebook,
  };
}

export function checkHashes(files, release) {
  for (const [name, body] of Object.entries(files)) {
    const sum = createHash("sha256").update(body).digest("hex");
    if (sum !== release.sha256[name]) fail(`${name} does not match RELEASE.json (re-run the vendor script)`);
  }
}

export function checkSchema(data, schema) {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(data)) {
    fail("aacf.json fails its schema:\n" + validate.errors.slice(0, 20)
      .map((e) => `  ${e.instancePath || "/"} ${e.message}`).join("\n"));
  }
}

async function main() {
  const release = JSON.parse(await readFile(new URL("RELEASE.json", VENDOR), "utf8"));
  const files = {};
  for (const name of ["aacf.json", "aacf.schema.json", "rulebook.md"]) files[name] = await readFile(new URL(name, VENDOR));
  checkHashes(files, release);
  const data = JSON.parse(files["aacf.json"]);
  checkSchema(data, JSON.parse(files["aacf.schema.json"]));
  const out = compact(data, release, files["rulebook.md"].toString("utf8"));
  await mkdir(new URL(".", OUT), { recursive: true });
  const text = JSON.stringify(out);
  await writeFile(OUT, text);
  const n = Object.keys(out.controls).length;
  console.log(`built ${OUT.pathname.split("/").slice(-3).join("/")}: AACF ${out.release.framework_version}, ` +
              `${n} controls, ${Object.keys(out.refs).length} sources, ${Math.round(text.length / 1024)} KiB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
