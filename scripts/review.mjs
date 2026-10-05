#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

const take = (name) => {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1] ?? null;
  argv.splice(index, value === null ? 1 : 2);
  return value;
};

const base = take("--base") ?? "HEAD";
const model = take("--model");
const session = take("--session");
const out = take("--out");
const json = argv.includes("--json");
const files = argv.filter((arg) => !arg.startsWith("--"));

const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
}).stdout?.trim() === "true";

if (!inRepo && files.length === 0) {
  console.error("review: not a git repository. Run `git init` or pass file paths to review.");
  process.exit(2);
}

const scope =
  files.length > 0
    ? `Only these files: ${files.join(", ")}.`
    : `The working tree diff against ${base}.`;

const prompt = [
  "Review the current changes against your ruleset.",
  `Scope: ${scope}`,
  "",
  `Run \`git diff ${base}\` and \`git status\` to see the change, then read the affected files.`,
  "Report only what should change, in the three-section format.",
].join("\n");

const args = ["run", "--agent", "reviewer", "--auto"];
if (model !== null) args.push("--model", model);
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

process.exit(result.status ?? 1);
