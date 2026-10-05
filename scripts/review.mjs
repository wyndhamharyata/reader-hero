#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);

const take = (name) => {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1] ?? null;
  argv.splice(index, value === null ? 1 : 2);
  return value;
};

const base = take("--base") ?? "HEAD";
const model = take("--model") ?? "opencode-go/deepseek-v4.1-flash#high";
const session = take("--session");
const out = take("--out");
const json = argv.includes("--json");
const files = argv.filter((arg) => !arg.startsWith("--"));

const runGit = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout ?? "" };
};

const inRepo = runGit("rev-parse", "--is-inside-work-tree").out.trim() === "true";

if (!inRepo && files.length === 0) {
  console.error("review: not a git repository. Run `git init` or pass file paths to review.");
  process.exit(2);
}

const pathArgs = files.length > 0 ? ["--", ...files] : [];
const baseOk = runGit("rev-parse", "--verify", "--quiet", base).ok;
const diffArgs = baseOk ? [base] : [];
const scope = baseOk
  ? `Working tree against ${base}.`
  : `Base ${base} not found; reviewing the working tree.`;

const bundle = [
  "# Review scope",
  "",
  scope,
  files.length > 0 ? `Files: ${files.join(", ")}` : "",
  "",
  "## git status --short",
  "",
  runGit("status", "--short").out,
  "",
  "## diff --stat",
  "",
  runGit("diff", ...diffArgs, "--stat", ...pathArgs).out,
  "",
  "## diff",
  "",
  runGit("diff", ...diffArgs, ...pathArgs).out,
  "",
  "## diff --cached",
  "",
  runGit("diff", "--cached", ...pathArgs).out,
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "reader-hero-review-"));
const diffPath = join(dir, "diff.md");
writeFileSync(diffPath, bundle);

const prompt = [
  "Review the current changes against your ruleset.",
  `The diff is attached at ${diffPath}. Read it first.`,
  "Files listed under `git status --short` as untracked (`??`) are not in the diff; read them directly.",
  "Read the affected files for context, then report only what should change, in the three-section format.",
].join("\n");

const args = ["run", "--agent", "reviewer", "--auto", "--model", model, "--file", diffPath];
if (session !== null) args.push("--session", session);
if (json) args.push("--format", "json");
args.push(prompt);

const result =
  out === null
    ? spawnSync("opencode", args, { stdio: "inherit" })
    : spawnSync("opencode", args, { encoding: "utf8" });

if (out !== null) {
  const stdout = result.stdout ?? "";
  writeFileSync(out, stdout);
  process.stdout.write(stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
