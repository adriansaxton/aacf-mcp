// Copy one tagged AACF release into vendor/aacf/, so the server is built from a fixed, published release.
//
//   node scripts/vendor-release.mjs v1.2.1                  fetch the files from GitHub at that tag
//   node scripts/vendor-release.mjs v1.2.1 --from <dir>     copy them from a local clone checked out at that tag
//
// Only public release files are used: data/aacf.json, data/aacf.schema.json and framework/rulebook.md.
// vendor/aacf/RELEASE.json records the tag and a SHA-256 for each file; build-data.mjs refuses files that differ.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_RAW = "https://raw.githubusercontent.com/adriansaxton/AACF";
const FILES = { "aacf.json": "data/aacf.json", "aacf.schema.json": "data/aacf.schema.json", "rulebook.md": "framework/rulebook.md" };
const OUT = new URL("../vendor/aacf/", import.meta.url);

const [tag, flag, dir] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: node scripts/vendor-release.mjs vX.Y.Z [--from <local clone>]");
  process.exit(2);
}
if (flag && (flag !== "--from" || !dir)) {
  console.error("the only option is --from <local clone>");
  process.exit(2);
}

async function get(path) {
  if (dir) return readFile(join(dir, path));
  const res = await fetch(`${REPO_RAW}/${tag}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

await mkdir(OUT, { recursive: true });
const sha256 = {};
for (const [name, path] of Object.entries(FILES)) {
  const body = await get(path);
  sha256[name] = createHash("sha256").update(body).digest("hex");
  await writeFile(new URL(name, OUT), body);
}

const data = JSON.parse(await readFile(new URL("aacf.json", OUT), "utf8"));
const version = data.meta.framework.version;
if (`v${version}` !== tag) throw new Error(`tag ${tag} holds framework version ${version}`);

await writeFile(new URL("RELEASE.json", OUT),
  JSON.stringify({ tag, framework_version: version, schema_version: data.meta.schema_version,
                   source: dir ? `local clone at ${tag}` : `${REPO_RAW}/${tag}`, sha256 }, null, 2) + "\n");
console.log(`vendored AACF ${tag} (schema ${data.meta.schema_version})`);
