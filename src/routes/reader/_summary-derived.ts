import type { Summary } from "@/domain/ai";
import type { Chapter } from "@/use-cases/ai-context";
import type { Coverage, SummaryInput, SummaryRun } from "@/use-cases/summary";

export function summaryView({
  summary,
  cover,
  input,
  run,
  list,
  isStory,
  tab,
}: {
  readonly summary: Summary | null;
  readonly cover: Coverage;
  readonly input: SummaryInput;
  readonly run: SummaryRun | null;
  readonly list: ReadonlyArray<Chapter>;
  readonly isStory: boolean;
  readonly tab: "chapters" | "names";
}): {
  readonly visibleChapters: ReadonlyArray<{ readonly heading: string; readonly paragraph: string }>;
  readonly names: ReadonlyArray<{
    readonly name: string;
    readonly note: string;
    readonly chapter: number;
  }>;
  readonly unit: string;
  readonly namesLabel: string;
  readonly stored: { readonly heading: string; readonly text: string } | undefined;
  readonly current: { readonly heading: string; readonly text: string } | null;
  readonly copied: string;
} {
  const visibleChapters = summary?.chapters.slice(0, cover.target) ?? [];
  // A story hides the names from after the position, so the list gives nothing away. The reader's own show.
  const names = (summary?.names ?? []).filter(
    (entry) => !isStory || entry.edited === true || entry.chapter <= cover.target,
  );
  const unit = isStory ? "chapter" : "section";
  const namesLabel = isStory ? "Characters" : "Terms";
  // A chapter that already has its own paragraph drops its "current position" entry.
  const stored =
    summary?.current !== undefined &&
    summary.current.end <= input.index + 1 &&
    !visibleChapters.some((chapter) => chapter.heading === summary.current?.heading)
      ? summary.current
      : undefined;
  let current: { heading: string; text: string } | null = null;

  if (run !== null && run.stage === "current") {
    current = { heading: list[run.chapter - 1]?.heading ?? "", text: run.text };
  } else if (stored !== undefined) {
    current = { heading: stored.heading, text: stored.text };
  }

  const copiedLines = visibleChapters.map((chapter) => `${chapter.heading}\n${chapter.paragraph}`);

  if (stored !== undefined)
    copiedLines.push(`${stored.heading} · current position\n${stored.text}`);

  const copied =
    tab === "chapters"
      ? copiedLines.join("\n\n")
      : names.map((entry) => `${entry.name}: ${entry.note}`).join("\n");

  return { visibleChapters, names, unit, namesLabel, stored, current, copied };
}
