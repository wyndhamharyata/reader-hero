import { Effect, Stream } from "effect";
import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { BookCover } from "@/components/BookCover";
import { ChevronDownIcon } from "@/components/icons";
import type { Summary } from "@/domain/ai";
import { forkApp, stopFiber } from "@/lib/hooks";
import type { LibraryCard, Shelf } from "@/lib/shelf";
import { SummaryStore } from "@/services/summary-store";
import type { Chapter } from "@/use-cases/ai-context";
import type { SummaryRun } from "@/use-cases/summary";

const ghostChapters = 6;

export interface EarlierVolume {
  readonly card: LibraryCard;
  readonly text: string | null;
}

// The volumes before this book, each with its stored paragraph, or the one the series run writes now.
export function useEarlierVolumes(
  series: Shelf["series"][number] | null,
  bookId: string,
  seriesRun: SummaryRun | null,
): ReadonlyArray<EarlierVolume> {
  const at = series?.books.findIndex((card) => card.book.id === bookId) ?? -1;
  const earlier = series === null || at <= 0 ? [] : series.books.slice(0, at);
  const ids = earlier.map((card) => card.book.id).join(" ");
  const [paragraphs, setParagraphs] = useState<ReadonlyMap<string, string | null>>(new Map());

  useEffect(() => {
    if (ids === "") return;

    const fiber = forkApp(
      Effect.flatMap(SummaryStore, (store) =>
        Effect.forEach(
          ids.split(" "),
          (id) =>
            store
              .watch(id)
              .pipe(
                Stream.runForEach((next) =>
                  Effect.sync(() =>
                    setParagraphs((current) =>
                      new Map(current).set(id, next?.volume?.text ?? null),
                    ),
                  ),
                ),
              ),
          { concurrency: "unbounded", discard: true },
        ),
      ),
    );

    return () => stopFiber(fiber);
  }, [ids]);

  return earlier.map((card) => {
    const isWriting =
      seriesRun?.stage === "volume" && seriesRun.book === card.book.id && seriesRun.text !== "";

    return {
      card,
      text: isWriting ? seriesRun.text : (paragraphs.get(card.book.id) ?? null),
    };
  });
}

// Open in the first chapters, where the earlier books matter most. Folded later.
function BeforeThisBook({
  volumes,
  isOpenAtFirst,
}: {
  readonly volumes: ReadonlyArray<EarlierVolume>;
  readonly isOpenAtFirst: boolean;
}): ReactElement {
  const [isOpen, setOpen] = useState(isOpenAtFirst);

  return (
    <details
      className="mb-2 rounded-[14px] bg-(--sunk) [background-image:var(--grain)] p-3.5 shadow-[inset_0_2px_5px_oklch(0%_0_0/0.12)]"
      open={isOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 font-sans text-[15px] font-bold [&::-webkit-details-marker]:hidden">
        Before this book
        <ChevronDownIcon
          className={`icon ml-auto size-4.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </summary>
      {volumes.map(({ card, text }) => (
        <div key={card.book.id} className="mt-3 flex gap-3">
          <span className="book w-11 shrink-0">
            <BookCover book={card.book} />
          </span>
          <p className={text === null ? "text-(--ink-soft)" : undefined}>
            <b className="font-sans">{card.book.title}.</b> {text ?? "Not summarised yet."}
          </p>
        </div>
      ))}
    </details>
  );
}

function YouAreHere(): ReactElement {
  return (
    <div className="mt-5 mb-1 flex items-center gap-2.5 font-sans text-[13px] font-bold text-(--green) before:flex-1 before:border-t-2 before:border-dashed before:border-(--green) after:flex-1 after:border-t-2 after:border-dashed after:border-(--green)">
      You are here
    </div>
  );
}

// The summary so far, in reading order: the earlier books, each chapter, the chapter in progress, then the questions.
export function SummaryBody({
  summary,
  chapters,
  run,
  list,
  current,
  volumes,
  isFirstChapters,
  openAt,
  pending,
  askError,
  targetRef,
}: {
  readonly summary: Summary | null;
  readonly chapters: ReadonlyArray<{ readonly heading: string; readonly paragraph: string }>;
  readonly run: SummaryRun | null;
  readonly list: ReadonlyArray<Chapter>;
  readonly current: { readonly heading: string; readonly text: string } | null;
  readonly volumes: ReadonlyArray<EarlierVolume>;
  readonly isFirstChapters: boolean;
  readonly openAt: number | null;
  readonly pending: string | null;
  readonly askError: string | null;
  readonly targetRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const entries: Array<{ key: string; heading: string; text: string; isWriting: boolean }> =
    chapters.map((chapter, index) => ({
      key: `${index}`,
      heading: chapter.heading,
      text: chapter.paragraph,
      isWriting: false,
    }));

  if (run !== null && run.stage === "chapter" && run.chapter > 0) {
    entries.push({
      key: `${run.chapter - 1}`,
      heading: list[run.chapter - 1]?.heading ?? "",
      text: run.text,
      isWriting: true,
    });
  }

  const target = openAt === null ? entries.length - 1 : openAt;

  return (
    <div className="text-base leading-relaxed [&>section:first-child>h3]:mt-1">
      {volumes.length > 0 && <BeforeThisBook volumes={volumes} isOpenAtFirst={isFirstChapters} />}
      {entries.map((entry, index) => (
        <section key={entry.key} className="rise">
          <h3
            ref={index === target ? targetRef : undefined}
            className="mt-4.5 mb-1 font-sans text-[15px] leading-snug font-bold"
          >
            {entry.heading}
          </h3>
          <p className={`whitespace-pre-wrap ${entry.isWriting ? "caret" : ""}`}>{entry.text}</p>
        </section>
      ))}
      {(entries.length > 0 || current !== null) && <YouAreHere />}
      {current !== null && (
        <section className="rise">
          <h3 className="mt-2 mb-1 font-sans text-[15px] leading-snug font-bold">
            {current.heading}, so far
          </h3>
          <p className={`whitespace-pre-wrap ${run?.stage === "current" ? "caret" : ""}`}>
            {current.text}
          </p>
        </section>
      )}
      {(summary?.thread.length ?? 0) > 0 && (
        <div className="mt-5.5 flex flex-col gap-2.5 font-sans text-[15px] leading-normal">
          {summary?.thread.map((message, index) =>
            message.role === "user" ? (
              <p
                key={index}
                className="max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-(--green-wash) px-3.5 py-2.5 font-semibold"
              >
                {message.content}
              </p>
            ) : (
              <p key={index} className="max-w-[92%] whitespace-pre-wrap">
                {message.content}
              </p>
            ),
          )}
        </div>
      )}
      {pending !== null && (
        <p className="mt-2.5 font-sans text-[15px] whitespace-pre-wrap">
          {pending === "" ? <span className="caret text-(--ink-soft)" /> : pending}
        </p>
      )}
      {askError !== null && <p className="mt-2 font-sans text-(--red)">{askError}</p>}
    </div>
  );
}

// What a summary will hold, drawn as empty lines, so the panel shows what Summarise makes.
export function SummaryGhost({
  list,
  target,
  volumes,
}: {
  readonly list: ReadonlyArray<Chapter>;
  readonly target: number;
  readonly volumes: ReadonlyArray<EarlierVolume>;
}): ReactElement | null {
  if (target === 0) return null;

  const shown = list.slice(Math.max(0, target - ghostChapters), target);
  const widths = ["85%", "75%", "80%", "65%", "70%", "78%"];

  return (
    <div className="opacity-45" aria-hidden="true">
      {volumes.length > 0 && (
        <div className="mb-2 rounded-[14px] bg-(--sunk) p-3.5">
          <b className="font-sans">Before this book</b>
          <div className="mt-3 flex gap-3">
            <span className="book w-11 shrink-0">
              <BookCover book={volumes[0]?.card.book ?? { id: "", title: "", format: "epub" }} />
            </span>
            <div className="flex-1">
              <div className="my-2 h-2.5 w-[90%] rounded-md bg-(--line)" />
              <div className="my-2 h-2.5 w-[70%] rounded-md bg-(--line)" />
            </div>
          </div>
        </div>
      )}
      {shown.map((chapter, index) => (
        <div key={chapter.start}>
          <h3 className="mt-4.5 mb-1 font-sans text-[15px] font-bold">{chapter.heading}</h3>
          <div className="my-2 h-2.5 rounded-md bg-(--line)" style={{ width: widths[index] }} />
        </div>
      ))}
      <YouAreHere />
    </div>
  );
}
