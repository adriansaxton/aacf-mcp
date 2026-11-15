import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byNatural, checkHashes, checkSchema, compact } from "../scripts/build-data.mjs";

const vendor = (name) => readFileSync(new URL(`../vendor/aacf/${name}`, import.meta.url), "utf8");
const release = JSON.parse(vendor("RELEASE.json"));
const fresh = () => JSON.parse(vendor("aacf.json"));
const out = compact(fresh(), release, vendor("rulebook.md"));
const source = fresh();
const sourceControls = source.domains.flatMap((d) => d.controls);

test("every control and domain is carried over, in framework order", () => {
  assert.equal(Object.keys(out.controls).length, sourceControls.length);
  assert.deepEqual(out.domains.map((d) => d.code), source.domains.map((d) => d.domain));
  assert.deepEqual(out.domains.flatMap((d) => d.controls), sourceControls.map((c) => c.id));
});

test("a control keeps every field of the published record", () => {
  for (const c of sourceControls) {
    const got = out.controls[c.id];
    for (const [k, v] of Object.entries(c)) {
      if (k === "mappings") continue;
      assert.deepEqual(got[k], v, `${c.id}.${k}`);
    }
    const back = got.mappings.map(([s, r, strength, confidence]) =>
      ({ source: s, ref: r, strength, label: out.refs[s][r], confidence }));
    assert.deepEqual(back, c.mappings, `${c.id}.mappings`);
  }
});

test("the reverse index holds every mapping exactly once", () => {
  const forward = sourceControls.flatMap((c) => c.mappings.map((m) => `${m.source}|${m.ref}|${c.id}|${m.strength}`)).sort();
  const reverse = Object.entries(out.by_ref).flatMap(([s, refs]) =>
    Object.entries(refs).flatMap(([r, hits]) => hits.map(([id, strength]) => `${s}|${r}|${id}|${strength}`))).sort();
  assert.deepEqual(reverse, forward);
});

test("coverage counts agree with the reverse index", () => {
  for (const [s, cov] of Object.entries(out.coverage)) {
    const items = Object.values(out.by_ref[s]);
    assert.equal(cov.items, items.length);
    assert.equal(cov.items_direct + cov.items_partial_only, cov.items, s);
  }
});

test("held-back sources never appear", () => {
  assert.equal(out.vocab.sources.AICM, undefined);
  assert.equal(out.refs.AICM, undefined);
});

test("references sort in natural order", () => {
  assert.deepEqual(["4.10", "A.2", "4.2", "4.1.1"].sort(byNatural), ["4.1.1", "4.2", "4.10", "A.2"]);
  assert.deepEqual(["LLM10:2026", "LLM02:2026", "LLM01:2026"].sort(byNatural), ["LLM01:2026", "LLM02:2026", "LLM10:2026"]);
});

test("citation and release details are present", () => {
  assert.equal(out.release.framework_version, source.meta.framework.version);
  assert.equal(out.release.tag, `v${source.meta.framework.version}`);
  assert.equal(out.citation.licence.name, "CC BY-SA 4.0");
  assert.match(out.citation.doi_all_versions, /^10\.5281\/zenodo\.\d+$/);
  assert.match(out.rulebook, /^# Assessor rulebook/);
});

test("refuses a different schema major version", () => {
  const d = fresh();
  d.meta.schema_version = "2.0.0";
  assert.throws(() => compact(d, release, ""), /not major 1/);
});

test("refuses a mapping to an unknown source", () => {
  const d = fresh();
  d.domains[0].controls[0].mappings.push({ source: "NOPE", ref: "1", strength: "direct", label: "x", confidence: "high" });
  assert.throws(() => compact(d, release, ""), /unknown source NOPE/);
});

test("refuses two labels for the same source item", () => {
  const d = fresh();
  const m = { ...d.domains[0].controls[0].mappings[0] };
  d.domains[1].controls[0].mappings.push({ ...m, label: "something else" });
  assert.throws(() => compact(d, release, ""), /two different labels/);
});

test("refuses a dependency on a missing control", () => {
  const d = fresh();
  d.domains[0].controls[0].dependencies.push("ZZZ-99");
  assert.throws(() => compact(d, release, ""), /depends on missing ZZZ-99/);
});

test("the vendored files match RELEASE.json, and a changed byte is refused", () => {
  const files = Object.fromEntries(["aacf.json", "aacf.schema.json", "rulebook.md"].map((n) => [n, Buffer.from(vendor(n))]));
  checkHashes(files, release);
  files["rulebook.md"] = Buffer.from(vendor("rulebook.md") + " ");
  assert.throws(() => checkHashes(files, release), /rulebook.md does not match/);
});

test("the vendored data passes its schema, and an undeclared field is refused", () => {
  const schema = JSON.parse(vendor("aacf.schema.json"));
  checkSchema(fresh(), schema);
  const d = fresh();
  d.domains[0].controls[0].surprise = 1;
  assert.throws(() => checkSchema(d, schema), /fails its schema/);
});
