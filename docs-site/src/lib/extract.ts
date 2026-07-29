/**
 * The one place documentation pulls facts out of the source.
 *
 * meadow only needs a single extractor — `// #region` snippets, so a page can
 * show real code rather than a copy that quietly drifts. BrowserHive's version
 * of this file also builds a glossary and type tables via ts-morph; meadow has
 * neither a glossary nor an interface worth tabulating, so this reads the file
 * directly and drops the dependency.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The meadow root. `docs-site` sits directly under it, and every script
// (astro dev/build, node) runs with `docs-site` as its cwd — so the parent is
// the repo. `import.meta.url` is not usable here: the astro build bundles this
// file and the URL becomes a path inside `dist`.
const ROOT = resolve(process.cwd(), "..");

/**
 * The current text between `// #region <name>` and `// #endregion`.
 *
 * Throws when the region is gone, which fails the astro build — that is the
 * point. A renamed or deleted region has to break the docs loudly rather than
 * leave a page showing code that no longer exists.
 */
export function sourceRegion(file: string, region: string): string {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const re = new RegExp(String.raw`//\s*#region\s+${region}\b([\s\S]*?)//\s*#endregion`);
  const m = re.exec(text);
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return (m[1] ?? "").replace(/^\n/, "").replace(/\s+$/, "");
}
