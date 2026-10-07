import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
// Generated files: the benchmark PDF, results and logs. Ignored by git.
export const benchDir = join(repoRoot, ".bench");
export const distRoot = join(repoRoot, "dist", "client");
