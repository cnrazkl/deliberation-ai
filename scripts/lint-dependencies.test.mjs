import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const web = resolve(repo, "apps/web");
const webRequire = createRequire(join(web, "package.json"));
const configRequire = createRequire(webRequire.resolve("eslint-config-next"));
const pluginEntry = configRequire.resolve("@next/eslint-plugin-next");
const pluginRequire = createRequire(pluginEntry);
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js");
const { ESLint } = webRequire("eslint");
const fixture = mkdtempSync(join(tmpdir(), "da103-lint-"));
// Only this generated fixture tree is removed; no repository or owner data.
after(() => {
  assert.equal(dirname(fixture), resolve(tmpdir()));
  assert.ok(basename(fixture).startsWith("da103-lint-"));
  rmSync(fixture, { recursive: true, force: true });
});
for (const dir of ["apps/alpha/app/about", "apps/beta/src/app/evidence", "apps/alpha/pages", "apps/beta/src/pages", "apps/.hidden/app", "apps/alpha/nested"]) {
  mkdirSync(join(fixture, dir), { recursive: true });
}
writeFileSync(join(fixture, "apps/alpha/app/about/page.tsx"), "export default function Page() { return null; }");
writeFileSync(join(fixture, "apps/beta/src/app/evidence/page.tsx"), "export default function Page() { return null; }");
for (const file of ["apps/alpha/app/page.tsx", "apps/beta/src/app/page.tsx", "apps/alpha/pages/about.tsx", "apps/beta/src/pages/evidence.tsx"]) {
  writeFileSync(join(fixture, file), "export default function Page() { return null; }");
}
writeFileSync(join(fixture, "apps/file.txt"), "generated fixture");
const normalized = (values) => values.map((value) => value.replace(/\\/g, "/")).sort();
const pattern = (suffix) => `${fixture.replace(/\\/g, "/")}/${suffix}`;
const roots = (rootDir) => getRootDirs({ cwd: web, settings: { next: { rootDir } } });

test("reviewed dependency graph removes the vulnerable glob chain", () => {
  const manifest = JSON.parse(readFileSync(resolve(dirname(pluginEntry), "../package.json"), "utf8"));
  assert.equal(manifest.version, "16.3.6", "Review this scoped substitution when upgrading Next lint");
  const replacement = JSON.parse(readFileSync(resolve(dirname(pluginRequire.resolve("fast-glob")), "../package.json"), "utf8"));
  assert.equal(replacement.name, "tinyglobby");
  assert.equal(replacement.version, "0.2.17");
  assert.equal(typeof pluginRequire("fast-glob").globSync, "function");
  const lock = readFileSync(join(repo, "pnpm-lock.yaml"), "utf8");
  assert.doesNotMatch(lock, /^ {2}(?:braces|micromatch|fast-glob)@/m);
  const patch = readFileSync(join(repo, "patches/@next__eslint-plugin-next@16.3.6.patch"), "utf8");
  assert.ok(!patch.includes("\r"), "Patch bytes must stay identical on Windows and Linux");
  const patchHash = createHash("sha256").update(patch).digest("hex");
  assert.ok(lock.includes(`'@next/eslint-plugin-next@16.3.6': ${patchHash}`), "Frozen lockfile must authenticate the reviewed patch");
});

test("Next lint only consumes the reviewed directory discovery interface", () => {
  const root = dirname(pluginEntry);
  const references = [];
  function inspect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.name.endsWith(".js") && readFileSync(path, "utf8").includes('require("fast-glob")')) references.push(path);
    }
  }
  inspect(root);
  assert.deepEqual(references, [join(root, "utils/get-root-dirs.js")]);
  const source = readFileSync(references[0], "utf8");
  assert.match(source, /_fastglob\.globSync/);
  assert.match(source, /_fastglob\.isDynamicPattern/);
  assert.match(source, /onlyDirectories: true/);
  assert.doesNotMatch(source, /_fastglob\.(?:sync|glob|stream|default)\b/);
});

test("relative prefixes, trailing separators and recursive roots preserve baseline discovery", () => {
  const children = ["apps/alpha/app", "apps/alpha/app/about", "apps/alpha/nested", "apps/alpha/pages",
    "apps/beta/src", "apps/beta/src/app", "apps/beta/src/app/evidence", "apps/beta/src/pages"];
  const all = ["apps/alpha", "apps/beta", ...children];
  const cases = [
    ["apps/*", ["apps/alpha", "apps/beta"]],
    ["./apps/*", ["./apps/alpha", "./apps/beta"]],
    ["apps/*/", ["apps/alpha", "apps/beta"]],
    ["apps/alpha/", ["apps/alpha/"]],
    ["./apps/alpha", ["./apps/alpha"]],
    [".", ["."]], ["./", ["./"]],
    ["apps/**", all],
    ["apps/alpha/**", children.filter((value) => value.startsWith("apps/alpha/"))],
    ["apps/{alpha,beta}/**", children],
    ["apps/**/app/**", ["apps/alpha/app", "apps/alpha/app/about", "apps/beta/src/app", "apps/beta/src/app/evidence"]],
    ["**", ["apps", ...all]],
    ["!apps/beta", []],
    [pattern("!apps/beta"), []],
  ];
  const originalCwd = process.cwd();
  try {
    process.chdir(fixture);
    for (const [input, expected] of cases) assert.deepEqual(normalized(roots(input)), normalized(expected), input);
    assert.deepEqual(normalized(roots(pattern("**"))), normalized(["apps", ...all].map(pattern)));
  } finally { process.chdir(originalCwd); }
});

test("directory discovery preserves literal, glob, brace, extglob and Windows path results", () => {
  const both = normalized([pattern("apps/alpha"), pattern("apps/beta")]);
  const cases = [
    [pattern("apps/alpha"), [pattern("apps/alpha")]],
    [pattern("apps/*"), both],
    [pattern("apps/{alpha,beta}"), both],
    [pattern("apps/@(alpha|beta)"), both],
    [pattern("apps/*").replace(/\//g, "\\"), both],
    [pattern("apps/.hidden"), [pattern("apps/.hidden")]],
    [pattern("apps/file.txt"), []],
    [pattern("missing/*"), []],
    [[pattern("apps/alpha"), pattern("apps/beta"), null], both],
  ];
  for (const [input, expected] of cases) assert.deepEqual(normalized(roots(input)), normalized(expected), JSON.stringify(input));
  assert.deepEqual(getRootDirs({ cwd: web, settings: {} }), [web]);
});

test("all 113 configured lint rules retain their pre-substitution settings", async () => {
  const eslint = new ESLint({ cwd: web });
  const config = await eslint.calculateConfigForFile(join(web, "src/app/page.tsx"));
  const rules = Object.fromEntries(Object.entries(config.rules).sort(([a], [b]) => a.localeCompare(b, "en")));
  assert.equal(Object.keys(rules).length, 113);
  // Captured from the original installed fast-glob graph before substitution.
  assert.equal(createHash("sha256").update(JSON.stringify(rules)).digest("hex"), "e809ea1c5cccec205e74738d64d3f93ea3e7577838c1f5664d6a4305cf1500b5");
});

test("monorepo root globs still detect internal anchors for Pages and both app layouts", async () => {
  for (const [rootDir, href] of [[pattern("apps/a*"), "/"], [pattern("apps/b*"), "/"], [pattern("apps/*"), "/about/"], [pattern("apps/*"), "/evidence/"]]) {
    const eslint = new ESLint({ cwd: web, overrideConfig: { settings: {
      next: { rootDir }, react: { version: webRequire("react/package.json").version },
    } } });
    const [result] = await eslint.lintText(`export default function Page() { return <a href="${href}">Open</a>; }`,
      { filePath: join(web, "src/app/da103-lint-fixture.tsx") });
    assert.ok(result.messages.some((message) => message.ruleId === "@next/next/no-html-link-for-pages" && message.severity === 2), JSON.stringify({ href, messages: result.messages }));
    assert.ok(!result.messages.some((message) => message.fatal));
  }
  const eslint = new ESLint({ cwd: web, overrideConfig: { settings: {
    next: { rootDir: pattern("apps/*") }, react: { version: webRequire("react/package.json").version },
  } } });
  const [external] = await eslint.lintText('export default function Page() { return <a href="https://example.com/">Open</a>; }',
    { filePath: join(web, "src/app/da103-lint-fixture.tsx") });
  assert.ok(!external.messages.some((message) => message.ruleId === "@next/next/no-html-link-for-pages"));
});

test("deep nested brace input cannot crash the replacement walker", () => {
  const modulePath = pluginRequire.resolve("fast-glob");
  const result = spawnSync(process.execPath, ["-e", `
    const { globSync } = require(process.argv[1]);
    const { getRootDirs } = require(process.argv[2]);
    for (const depth of [1000, 3000]) {
      const pattern = "{".repeat(depth) + "x" + "}".repeat(depth);
      for (const invoke of [() => globSync(pattern, { onlyDirectories: true }),
        () => getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: pattern } } })]) {
        try { invoke(); } catch (error) { if (error instanceof RangeError) throw error; }
      }
    }
  `, modulePath, pluginRequire.resolve("./utils/get-root-dirs.js")], { cwd: fixture, timeout: 5_000, maxBuffer: 8_192, encoding: "utf8" });
  assert.equal(result.error, undefined, "Nested patterns must finish within the subprocess time limit");
  assert.equal(result.status, 0, result.stderr);
});
