import { Effect, Stream } from "effect";
import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { BookCover } from "@/components/BookCover";
import { ChevronDownIcon } from "@/components/icons";
import type { Summary } from "@/domain/ai";
import { forkApp, stopFiber } from "@/lib/hooks";
import { titleInSeries, type LibraryCard, type Shelf } from "@/lib/shelf";
import { SummaryStore } from "@/services/summary-store";
import type { Chapter } from "@/use-cases/ai-context";
import type { SummaryRun } from "@/use-cases/summary";

const ghostChapters = 6;

export interface EarlierVolume {
  readonly card: LibraryCard;
  // Without the series name, which the block already gives: "Vol. 2".
  readonly title: string;
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
      title: titleInSeries(card.book.title, series?.name ?? ""),
      text: isWriting ? seriesRun.text : (paragraphs.get(card.book.id) ?? null),
    };
  });
}

// Open in the first chapters, where the earlier books matter most. The panel holds the reader's choice across a visit to a volume.
function BeforeThisBook({
  volumes,
  isOpenAtFirst,
  openChoice,
  onOpenChoice,
  onVolume,
}: {
  readonly volumes: ReadonlyArray<EarlierVolume>;
  readonly isOpenAtFirst: boolean;
  readonly openChoice: boolean | null;
  readonly onOpenChoice: (isOpen: boolean) => void;
  readonly onVolume: (id: string) => void;
}): ReactElement {
  const isOpen = openChoice ?? isOpenAtFirst;

  return (
    <details
      className="mb-2 rounded-[14px] bg-(--sunk) [background-image:var(--grain)] p-3.5 shadow-[inset_0_2px_5px_oklch(0%_0_0/0.12)]"
      open={isOpen}
      onToggle={(event) => onOpenChoice(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 font-sans text-[15px] font-bold [&::-webkit-details-marker]:hidden">
        Before this book
        <ChevronDownIcon
          className={`icon ml-auto size-4.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </summary>
      {volumes.map(({ card, title, text }) => (
        <button
          key={card.book.id}
          type="button"
          data-volume={card.book.id}
          aria-label={title}
          className="volume-row"
          onClick={() => onVolume(card.book.id)}
        >
          <span className="book w-11 shrink-0">
            <BookCover book={card.book} />
          </span>
          <span
            className={`line-clamp-3 min-w-0 flex-1 md:line-clamp-4 ${text === null ? "text-(--ink-soft)" : ""}`}
          >
            <b className="font-sans">{title}.</b> {text ?? "Not summarised yet."}
          </span>
          <span className="chev self-center text-(--ink-soft)" aria-hidden="true">
            ›
          </span>
        </button>
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
  volumesOpen,
  onVolumesOpen,
  onVolume,
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
  readonly volumesOpen: boolean | null;
  readonly onVolumesOpen: (isOpen: boolean) => void;
  readonly onVolume: (id: string) => void;
}): ReactElement {
  const entries: Array<{ key: string; heading: string; text: string; isWriting: boolean }> =
    chapters.map((chapter, index) => ({
      key: `${index}`,
      heading: chapter.heading,
      text: chapter.paragraph,
      isWriting: false,
    }));
  const isWriting = run !== null && run.stage === "chapter" && run.chapter > 0;

  if (isWriting) {
    const writing = run.chapter - 1;

    entries.splice(writing, 1, {
      key: `${writing}`,
      heading: list[writing]?.heading ?? "",
      text: run.text,
      isWriting: true,
    });
  }

  const target = openAt === null ? entries.length - 1 : openAt;

  return (
    <div className="text-base leading-relaxed [&>section:first-child>h3]:mt-1">
      {volumes.length > 0 && (
        <BeforeThisBook
          volumes={volumes}
          isOpenAtFirst={isFirstChapters}
          openChoice={volumesOpen}
          onOpenChoice={onVolumesOpen}
          onVolume={onVolume}
        />
      )}
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

// One earlier volume's recap in full, at reading size.
export function VolumeRecap({ volume }: { readonly volume: EarlierVolume }): ReactElement {
  return (
    <div className="mx-auto max-w-[62ch] text-[17px] leading-relaxed">
      <span className="book mx-auto mt-2 mb-5 block w-24">
        <BookCover book={volume.card.book} />
      </span>
      <p className={`whitespace-pre-wrap ${volume.text === null ? "text-(--ink-soft)" : ""}`}>
        {volume.text ?? "Not summarised yet."}
      </p>
    </div>
  );
}
