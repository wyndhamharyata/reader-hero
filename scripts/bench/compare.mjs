// Prints two benchmark runs side by side: npm run bench:compare -- <before> <after>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { benchDir } from "./paths.mjs";

const [before, after] = [process.argv[2] ?? "baseline", process.argv[3] ?? "after"];
const load = (label, layout) =>
  JSON.parse(readFileSync(join(benchDir, "results", `${label}-${layout}.json`), "utf8"));

const rows = (r) => ({
  "launch, slow network (ms)": r.launch?.slowNetworkReadyMs,
  "launch, offline (ms)": r.launch?.offline.readyMs ?? r.launch?.offline.error,
  "import: parsed (ms)": r.import?.parseMs,
  "import: figures done (ms)": r.import?.figuresMs,
  "import: WebKit CPU (s)": r.import?.cpuS,
  "import: frames >34ms": r.import?.frames.over34,
  "reader open (ms)": r.reader?.openMs,
  "reader steady scroll CPU (s)": r.reader?.steady.cpuS,
  "reader steady frames >34ms": r.reader?.steady.over34,
  "reader fling CPU (s)": r.reader?.fling.cpuS,
  "reader fling frames >34ms": r.reader?.fling.over34,
  "original: document open (ms)": r.original?.openMs,
  "original: first page painted (ms)": r.original?.firstPageMs,
  "original scroll CPU (s)": r.original?.cpuS,
  "original scroll frames >34ms": r.original?.frames.over34,
  "original scroll blocked (ms)": r.original?.frames.blockedMs,
  "original: failed pages": r.original?.failedPages,
});

for (const layout of ["desktop", "mobile"]) {
  const left = rows(load(before, layout));
  const right = rows(load(after, layout));
  console.log(`\n## ${layout}\n`);
  console.log(`| metric | ${before} | ${after} |`);
  console.log("| --- | --- | --- |");
  for (const key of Object.keys(left)) console.log(`| ${key} | ${left[key]} | ${right[key]} |`);
}
