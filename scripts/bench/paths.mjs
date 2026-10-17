import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
// Generated files are the benchmark PDF, results and logs, all ignored by git.
export const benchDir = join(repoRoot, ".bench");
export const distRoot = join(repoRoot, "dist", "client");
