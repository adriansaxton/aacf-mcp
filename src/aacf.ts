// Read-only queries over the compact AACF data (src/data/aacf.generated.json, built by scripts/build-data.mjs).
// Every function is pure and cheap: lookups and small filters over pre-built indexes, no parsing per request.

import raw from "./data/aacf.generated.json" with { type: "json" };

type Named = { name: string; meaning: string };
type Source = { name: string; url: string; layer: string; ref_pattern: string;
                provenance: { mapped_by: string; reviewed_by?: string; checked?: string } };
type Criterion = { id: string; applies: "core" | string[]; text: string };
type Hit = [control: string, strength: "direct" | "partial", confidence: string];
export type Control = {
  id: string; title: string; objective: string; rationale: string; levels: Record<string, string>;
  criteria: Criterion[]; questions: string[]; evidence: string[];
  guidance: { steps: string[]; pitfalls: string[]; artefacts: string[] };
  owner: { accountable: string; contributors: string[] }; lifecycle: string[]; applicability: string;
  dependencies: string[]; status: string; version: string; replaced_by?: string; domain: string;
  mappings: [source: string, ref: string, strength: string, confidence: string][];
};
type Profile = { name: string; summary: string; controls: { id: string; question: string }[] };
type Data = {
  release: { tag: string; framework_version: string; schema_version: string; updated: string };
  citation: { name: string; short_name: string; version: string; licence: { name: string; url: string };
              doi_all_versions: string; site: string; source: string };
  vocab: { scale: { baseline_level: number; levels: Record<string, Named> }; overlays: Record<string, Named>;
           owner_roles: Record<string, string>; lifecycle_stages: Record<string, string>;
           applicability: Record<string, string>; statuses: string[]; sources: Record<string, Source> };
  profiles: Record<string, Profile>;
  domains: { code: string; name: string; summary: string; note?: string; controls: string[] }[];
  controls: Record<string, Control>;
  refs: Record<string, Record<string, string>>;
  by_ref: Record<string, Record<string, Hit[]>>;
  coverage: Record<string, { items: number; items_direct: number; items_partial_only: number; controls: number }>;
  search: Record<string, string>;
  rulebook: string;
};

export const data = raw as unknown as Data;

/** Thrown for a request the caller can fix (unknown ID, standard, domain, ...). The message says how. */
export class LookupError extends Error {}

/** Attribution carried by every result, so answers built from it can be cited. */
export const citation = () => ({
  framework: `${data.citation.name} (${data.citation.short_name})`,
  version: data.release.framework_version,
  data_schema: data.release.schema_version,
  licence: `${data.citation.licence.name}, ${data.citation.licence.url}`,
  attribution: `${data.citation.name} by Adrian Saxton, version ${data.release.framework_version}, ` +
               `doi:${data.citation.doi_all_versions}`,
  doi: data.citation.doi_all_versions,
  url: data.citation.site,
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const controlUrl = (id: string) => `${data.citation.site}/controls/${id.toLowerCase()}/`;

function resolveStandard(standard: string): string {
  const want = norm(standard);
  for (const [key, s] of Object.entries(data.vocab.sources)) {
    if (norm(key) === want || norm(s.name) === want) return key;
  }
  for (const [key, s] of Object.entries(data.vocab.sources)) {
    if (norm(s.name).includes(want) || (want.length >= 4 && want.includes(norm(key)))) return key;
  }
  throw new LookupError(`Unknown standard "${standard}". Use one of: ` +
    Object.entries(data.vocab.sources).map(([k, s]) => `${k} (${s.name})`).join("; "));
}

function resolveDomain(domain: string): string {
  const want = norm(domain);
  let hit = data.domains.find((d) => norm(d.code) === want || norm(d.name) === want);
  if (!hit && want.length >= 3) {
    // A partial name ("Governance", "security") is fine when it points at exactly one domain.
    const partial = data.domains.filter((d) => norm(d.name).includes(want));
    if (partial.length === 1) hit = partial[0];
  }
  if (!hit) throw new LookupError(`Unknown domain "${domain}". Use one of: ` +
    data.domains.map((d) => `${d.code} (${d.name})`).join("; "));
  return hit.code;
}

function getControlRecord(id: string): Control {
  const c = data.controls[id.trim().toUpperCase()];
  if (!c) throw new LookupError(`No control "${id}". Control IDs look like GOV-01; use search_controls or ` +
    `list_domains to find one.`);
  return c;
}

const summary = (c: Control) => ({ id: c.id, title: c.title, domain: c.domain, objective: c.objective, url: controlUrl(c.id) });

export function frameworkInfo() {
  const v = data.vocab;
  return {
    name: data.citation.name, short_name: data.citation.short_name, version: data.release.framework_version,
    updated: data.release.updated, data_schema_version: data.release.schema_version,
    controls: Object.keys(data.controls).length, domains: data.domains.length,
    criteria: Object.values(data.controls).reduce((n, c) => n + c.criteria.length, 0),
    scale: { baseline_level: v.scale.baseline_level,
             levels: Object.fromEntries(Object.entries(v.scale.levels).map(([k, l]) => [k, `${l.name}: ${l.meaning}`])) },
    overlays: Object.fromEntries(Object.entries(v.overlays).map(([k, o]) => [k, `${o.name}: ${o.meaning}`])),
    owner_roles: v.owner_roles, lifecycle_stages: v.lifecycle_stages,
    standards: Object.fromEntries(Object.entries(v.sources).map(([k, s]) => [k, { name: s.name, url: s.url,
      cross_referenced_items: data.coverage[k]?.items ?? 0 }])),
    profiles: Object.fromEntries(Object.entries(data.profiles).map(([k, p]) => [k, { name: p.name, summary: p.summary,
      controls: p.controls.length }])),
    note: "Cross-references show which controls address an item of a standard. They are coverage, not a " +
          "compliance finding.",
    site: data.citation.site, source: data.citation.source, cite: citation(),
  };
}

export function listDomains() {
  return { domains: data.domains.map((d) => ({ code: d.code, name: d.name, summary: d.summary,
    ...(d.note && { note: d.note }),
    controls: d.controls.map((id) => ({ id, title: data.controls[id].title })) })), cite: citation() };
}

export function getControl(id: string) {
  const c = getControlRecord(id);
  const { mappings, domain, ...rest } = c;
  return {
    ...rest,
    domain: { code: domain, name: data.domains.find((d) => d.code === domain)!.name },
    owner: { accountable: { role: c.owner.accountable, description: data.vocab.owner_roles[c.owner.accountable] },
             contributors: c.owner.contributors },
    cross_references: mappings.map(([s, ref, strength, confidence]) => ({
      standard: s, standard_name: data.vocab.sources[s].name, ref, item: data.refs[s][ref], strength, confidence })),
    url: controlUrl(c.id), cite: citation(),
  };
}

export type SearchFilters = { text?: string; domain?: string; overlay?: string; owner_role?: string;
                              lifecycle_stage?: string; limit?: number };

export function searchControls(f: SearchFilters) {
  const terms = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const domain = f.domain ? resolveDomain(f.domain) : undefined;
  const overlay = f.overlay?.trim().toUpperCase();
  if (overlay && !data.vocab.overlays[overlay]) {
    throw new LookupError(`Unknown overlay "${f.overlay}". Use one of: ` +
      Object.entries(data.vocab.overlays).map(([k, o]) => `${k} (${o.name})`).join("; "));
  }
  const role = f.owner_role?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (role && !data.vocab.owner_roles[role]) {
    throw new LookupError(`Unknown owner role "${f.owner_role}". Use one of: ${Object.keys(data.vocab.owner_roles).join(", ")}`);
  }
  const stage = f.lifecycle_stage?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (stage && !data.vocab.lifecycle_stages[stage]) {
    throw new LookupError(`Unknown lifecycle stage "${f.lifecycle_stage}". Use one of: ` +
      Object.keys(data.vocab.lifecycle_stages).join(", "));
  }
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 100);
  const scored: { c: Control; score: number }[] = [];
  for (const d of data.domains) {
    if (domain && d.code !== domain) continue;
    for (const id of d.controls) {
      const c = data.controls[id];
      if (overlay && !c.criteria.some((k) => k.applies !== "core" && k.applies.includes(overlay))) continue;
      if (role && c.owner.accountable !== role && !c.owner.contributors.includes(role)) continue;
      if (stage && !c.lifecycle.includes(stage)) continue;
      let score = 0;
      if (terms.length) {
        const text = data.search[id];
        if (!terms.every((t) => text.includes(t))) continue;
        const title = c.title.toLowerCase();
        score = terms.reduce((n, t) => n + (title.includes(t) ? 3 : 0) + 1, 0);
      }
      scored.push({ c, score });
    }
  }
  if (terms.length) scored.sort((a, b) => b.score - a.score);
  return {
    total: scored.length, returned: Math.min(scored.length, limit),
    controls: scored.slice(0, limit).map(({ c }) => summary(c)),
    ...(scored.length === 0 && { hint: "No match. Try fewer or broader words, or drop a filter." }),
    cite: citation(),
  };
}

export function getMapping(standard: string, ref: string) {
  const s = resolveStandard(standard);
  const want = ref.trim().replace(/^(clause|article|art\.?|section)\s*/i, "");
  const refs = data.by_ref[s] ?? {};
  let keys = Object.keys(refs).filter((r) => r.toLowerCase() === want.toLowerCase());
  let match: "exact" | "prefix" = "exact";
  if (!keys.length) {
    match = "prefix";
    keys = Object.keys(refs).filter((r) => r.toLowerCase().startsWith(want.toLowerCase()));
  }
  if (!keys.length) {
    throw new LookupError(`${data.vocab.sources[s].name} item "${ref}" is not cross-referenced. ` +
      `Use get_standard_coverage("${s}") to list the items that are.`);
  }
  return {
    standard: s, standard_name: data.vocab.sources[s].name, match,
    items: keys.map((r) => ({ ref: r, item: data.refs[s][r],
      controls: refs[r].map(([id, strength, confidence]) => ({ id, title: data.controls[id].title, strength,
        confidence, url: controlUrl(id) })) })),
    note: "direct: the control addresses the item; partial: it addresses part of it. Coverage, not a compliance finding.",
    cite: citation(),
  };
}

export function getStandardCoverage(standard: string) {
  const s = resolveStandard(standard);
  const src = data.vocab.sources[s];
  return {
    standard: s, name: src.name, url: src.url, provenance: src.provenance, summary: data.coverage[s],
    items: Object.entries(data.by_ref[s]).map(([ref, hits]) => ({ ref, item: data.refs[s][ref],
      best: hits.some((h) => h[1] === "direct") ? "direct" : "partial",
      controls: hits.map(([id, strength]) => `${id} (${strength})`) })),
    note: "Only items with at least one cross-reference are listed. Coverage, not a compliance finding.",
    cite: citation(),
  };
}

export function assessmentQuestions(opts: { domain?: string; profile?: string; overlays?: string[] }) {
  const overlays = (opts.overlays ?? []).map((o) => o.trim().toUpperCase());
  for (const o of overlays) {
    if (!data.vocab.overlays[o]) throw new LookupError(`Unknown overlay "${o}". Use one of: ` +
      Object.entries(data.vocab.overlays).map(([k, v]) => `${k} (${v.name})`).join("; "));
  }
  const applies = (k: Criterion) => k.applies === "core" || k.applies.some((o) => overlays.includes(o));
  const howTo = "Ask these questions, record each applicable Level 3 criterion as met, not met or not evidenced, " +
    "then place a level with get_scoring_rules. Keep the answers on your side: this server never receives them.";

  if (opts.profile) {
    const p = data.profiles[opts.profile.trim().toLowerCase()];
    if (!p) {
      const known = Object.keys(data.profiles);
      throw new LookupError(known.length ? `Unknown profile "${opts.profile}". Use one of: ${known.join(", ")}`
        : `No profiles are published in this version (${data.release.framework_version}) yet. Use a domain instead.`);
    }
    return { profile: opts.profile, name: p.name, summary: p.summary, how_to: howTo,
      controls: p.controls.map(({ id, question }) => ({ id, title: data.controls[id].title, question })), cite: citation() };
  }
  if (!opts.domain) {
    return {
      how_to: "Pick a domain (or a profile, when one is published) and call again. Assess one domain at a time.",
      domains: data.domains.map((d) => ({ code: d.code, name: d.name, controls: d.controls.length })),
      profiles: Object.keys(data.profiles), overlays: Object.fromEntries(
        Object.entries(data.vocab.overlays).map(([k, o]) => [k, `${o.name}: ${o.meaning}`])),
      cite: citation(),
    };
  }
  const code = resolveDomain(opts.domain);
  const d = data.domains.find((x) => x.code === code)!;
  return {
    domain: code, name: d.name, overlays_applied: overlays, how_to: howTo,
    controls: d.controls.map((id) => {
      const c = data.controls[id];
      const crit = c.criteria.filter(applies);
      return { id, title: c.title, questions: c.questions, evidence: c.evidence,
        level_3_criteria: crit.map((k) => ({ id: k.id, text: k.text, ...(k.applies !== "core" && { overlays: k.applies }) })),
        ...(crit.length === 0 && { note: "No criteria apply with these overlays: the control is N/A (rule 1.4)." }),
        levels: c.levels };
    }),
    cite: citation(),
  };
}

export function scoringRules() {
  const v = data.vocab;
  return {
    baseline_level: v.scale.baseline_level,
    scale: Object.fromEntries(Object.entries(v.scale.levels).map(([k, l]) => [k, `${l.name}: ${l.meaning}`])),
    statuses: ["Scored (0 to 5)", "Insufficient evidence", "Not assessed", "N/A"],
    rulebook: data.rulebook,
    cite: citation(),
  };
}
