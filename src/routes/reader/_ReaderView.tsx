import { useEffect, useRef, type CSSProperties } from "react";
import type { Block, ParsedBook, ReaderSettings } from "@/domain/book";
import { MarkedText } from "./_MarkedText";
import { ReaderImage } from "./_ReaderImage";

export interface JumpRequest {
  readonly index: number;
  readonly nonce: number;
}

interface Props {
  bookId: string;
  parsed: ParsedBook;
  settings: ReaderSettings;
  initialBlock: number;
  jump: JumpRequest | null;
  onPosition: (blockIndex: number) => void;
  onToggleChrome: () => void;
}

const headingClass: Record<number, string> = {
  1: "reader-heading mt-10 text-2xl",
  2: "reader-heading mt-8 text-xl",
  3: "reader-heading mt-6 text-lg",
};

function blockClass(block: Block): string {
  if (block.kind === "heading") return headingClass[block.level] ?? headingClass[3] ?? "";
  if (block.kind === "image") return "my-2";
  return "mt-4";
}

const VIEWPORT_FRACTION = 0.9;

export function ReaderView({
  bookId,
  parsed,
  settings,
  initialBlock,
  jump,
  onPosition,
  onToggleChrome,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<{ element: Element; offset: number } | null>(null);
  const restoredRef = useRef(false);

  // Saved progress only places the first open; later reloads (figures landing) must not move the reader.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || restoredRef.current) return;
    restoredRef.current = true;
    container
      .querySelector<HTMLElement>(`[data-block="${initialBlock}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [initialBlock]);

  // Safari has no CSS scroll anchoring: hold the top block in place when content above it resizes.
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;
    if (container === null || article === null) return;

    const measure = (): void => {
      const box = container.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
      const element = hit?.closest("[data-block]");
      if (element === null || element === undefined || !container.contains(element)) return;
      anchorRef.current = { element, offset: element.getBoundingClientRect().top - box.top };
    };
    const restore = (): void => {
      const anchor = anchorRef.current;
      if (anchor === null || !anchor.element.isConnected) return;
      const top =
        anchor.element.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += top - anchor.offset;
    };

    measure();
    container.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(restore);
    observer.observe(article);
    return () => {
      container.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (jump === null) return;
    const container = containerRef.current;
    if (container === null) return;
    container
      .querySelector<HTMLElement>(`[data-block="${jump.index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jump]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-block]"));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.getAttribute("data-block")));
        if (visible.length > 0) onPosition(Math.min(...visible));
      },
      { root: container, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );

    blocks.forEach((block) => observer.observe(block));
    return () => observer.disconnect();
  }, [parsed, onPosition]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a, button") !== null) return;
    const container = containerRef.current;
    if (container === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio < 0.3) {
      container.scrollBy({ top: -container.clientHeight * VIEWPORT_FRACTION, behavior: "smooth" });
      return;
    }
    if (ratio > 0.7) {
      container.scrollBy({ top: container.clientHeight * VIEWPORT_FRACTION, behavior: "smooth" });
      return;
    }
    onToggleChrome();
  };

  // Keys survive figures inserted earlier in the book; index keys made every later image reload.
  const seen = new Map<string, number>();
  const nodes = parsed.blocks.map((block, index) => {
    const imageId = block.imageId;
    const base =
      imageId !== undefined
        ? `image:${imageId}`
        : `${block.kind}:${block.page}:${block.text.slice(0, 48)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const image =
      block.kind === "image" && imageId !== undefined ? (
        <ReaderImage bookId={bookId} imageId={imageId} />
      ) : null;
    return {
      index,
      key: `${base}#${count}`,
      className: blockClass(block),
      node: image ?? <MarkedText text={block.text} marks={block.marks} />,
    };
  });

  // Justified lines without hyphenation leave wide gaps between words.
  const hyphens = settings.textAlign === "justify" ? "auto" : undefined;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overscroll-contain"
      onClick={handleClick}
    >
      <article
        ref={articleRef}
        className="reader-body mx-auto max-w-prose px-4 pt-4 pb-[calc(1rem+var(--safe-bottom))] md:max-w-[var(--text-width)]"
        data-font={settings.font}
        style={
          {
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
            hyphens,
            "--text-width": `${settings.textWidth}ch`,
          } as CSSProperties
        }
      >
        {nodes.map((entry) => (
          <div key={entry.key} data-block={entry.index} className={entry.className}>
            {entry.node}
          </div>
        ))}
      </article>
    </div>
  );
}
