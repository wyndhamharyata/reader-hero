import { Effect } from "effect";
import { hasConsent, type AiSettings } from "@/domain/ai";
import type { StorageFailure } from "@/domain/errors";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs } from "@/services/summary-jobs";

// A running job holds its start settings, so it would go on sending with the old key.
const endsRuns = (current: AiSettings | null, next: AiSettings | null): boolean =>
  current !== null &&
  (next === null ||
    next.provider !== current.provider ||
    next.baseUrl !== current.baseUrl ||
    next.apiKey !== current.apiKey ||
    !hasConsent(next));

export function saveAiSettings(
  next: AiSettings | null,
): Effect.Effect<void, StorageFailure, SettingsStore | SummaryJobs> {
  return Effect.gen(function* () {
    const store = yield* SettingsStore;

    if (endsRuns(yield* store.ai(), next)) yield* (yield* SummaryJobs).stopAll();
    yield* store.putAi(next);
  });
}
