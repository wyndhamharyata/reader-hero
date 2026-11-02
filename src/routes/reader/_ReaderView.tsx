import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fontFamily, type Block, type ParsedBook, type ReaderSettings } from "@/domain/book";
import { prefersLessMotion } from "@/lib/open-book";
import { useTapFilter } from "@/lib/use-tap-filter";
import { MarkedText } from "./_MarkedText";
import { ReaderImage } from "./_ReaderImage";

const FONT_FALLBACK_MS = 1500;

export interface JumpRequest {
  readonly index: number;
  readonly nonce: number;
}

// A search match: characters `start` to `end` of a block's text.
export interface FindTarget {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

interface Props {
  bookId: string;
  parsed: ParsedBook;
  settings: ReaderSettings;
  initialBlock: number;
  jump: JumpRequest | null;
  onPosition: (blockIndex: number) => void;
  onToggleChrome: () => void;
  onPageTurn: () => void;
  find: FindTarget | null;
  // The reader's own picture: it opens the book, above the first block.
  hasCustomCover: boolean;
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
// The reading line is this far down the screen, so a top bar shown over the page never covers it.
const topRoomPx = 64;
const turnMs = 120;
const turnShiftPx = 18;
const nudgeMs = 200;
const nudgePx = 5;

// Instant, then a short slide, so a tap turns a page at once and the eye still sees which way it went.
function turnPage(container: HTMLElement, direction: 1 | -1): void {
  const maxScroll = container.scrollHeight - container.clientHeight;
  const isAtEnd = direction > 0 ? container.scrollTop >= maxScroll - 1 : container.scrollTop <= 0;
  const isStill = prefersLessMotion();

  if (isAtEnd) {
    if (isStill) return;

    const nudge = `translateY(${-direction * nudgePx}px)`;

    container.animate([{ transform: "none" }, { transform: nudge }, { transform: "none" }], {
      duration: nudgeMs,
      easing: "ease-out",
    });
    return;
  }

  container.scrollTop += direction * container.clientHeight * VIEWPORT_FRACTION;
  if (isStill) return;

  container.animate(
    [
      { transform: `translateY(${direction * turnShiftPx}px)`, opacity: 0.55 },
      { transform: "none", opacity: 1 },
    ],
    { duration: turnMs, easing: "ease-out" },
  );
}

// The text nodes of a block, walked to the match's characters, so the mark spans any bold or link inside.
function rangeOf(block: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let hasStart = false;

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;

    if (!hasStart && start < seen + length) {
      range.setStart(node, start - seen);
      hasStart = true;
    }

    if (hasStart && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }

    seen += length;
  }

  return null;
}

// Memoised so the parent's per-position renders do not re-map every block of the book.
export const ReaderView = memo(function ReaderView({
  bookId,
  parsed,
  settings,
  initialBlock,
  jump,
  onPosition,
  onToggleChrome,
  onPageTurn,
  find,
  hasCustomCover,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tap = useTapFilter();
  const articleRef = useRef<HTMLElement>(null);
  // Every block's top edge in content coordinates, read once per layout change.
  const blocksRef = useRef<{ nodes: HTMLElement[]; tops: number[] }>({ nodes: [], tops: [] });
  const anchorRef = useRef<{ element: Element; offset: number } | null>(null);
  const positionRef = useRef(-1);
  const restoredRef = useRef(false);

  // The text waits for its font, as WebKit has no scroll anchoring to hold the position in a reflow.
  const fontSpec = `1em "${fontFamily[settings.font]}"`;
  const [fontReady, setFontReady] = useState(() => document.fonts.check(fontSpec));

  useEffect(() => {
    if (fontReady || document.fonts.check(fontSpec)) {
      setFontReady(true);
      return;
    }

    let isActive = true;
    const show = (): void => {
      if (isActive) setFontReady(true);
    };
    // A font that never loads must not hold the book back.
    const timer = window.setTimeout(show, FONT_FALLBACK_MS);

    void document.fonts.load(fontSpec).then(show, show);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [fontSpec, fontReady]);

  // Before paint, so no frame shows the top. Only the first open, as figures arriving later must not move it.
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (container === null || restoredRef.current || !fontReady) return;

    const target = container.querySelector<HTMLElement>(`div[data-block="${initialBlock}"]`);

    if (target === null) return;

    restoredRef.current = true;
    container.scrollTop +=
      target.getBoundingClientRect().top - container.getBoundingClientRect().top - topRoomPx;
  }, [initialBlock, fontReady]);

  // A scroll does a binary search, not observers: WebKit recomputes observers on every frame.
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;

    if (container === null || article === null || !fontReady) return;

    const measure = (): void => {
      const nodes = Array.from(container.querySelectorAll<HTMLElement>("div[data-block]"));
      const base = container.getBoundingClientRect().top - container.scrollTop;

      blocksRef.current = {
        nodes,
        tops: nodes.map((node) => node.getBoundingClientRect().top - base),
      };
    };
    // The last block that starts at or above `y`.
    const indexAt = (y: number): number => {
      const tops = blocksRef.current.tops;
      let low = 0;
      let high = tops.length - 1;
      let found = 0;

      while (low <= high) {
        const mid = (low + high) >> 1;

        if ((tops[mid] ?? 0) <= y) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return found;
    };
    const onScroll = (): void => {
      const { nodes, tops } = blocksRef.current;

      if (nodes.length === 0) return;

      const top = container.scrollTop;
      const topIndex = indexAt(top + topRoomPx + 8);
      const node = nodes[topIndex];
      const nodeTop = tops[topIndex];

      if (node !== undefined && nodeTop !== undefined) {
        anchorRef.current = { element: node, offset: nodeTop - top };
      }

      // The top block brings a resume to the same screen. The last block marks the book finished.
      const atEnd = top + container.clientHeight >= container.scrollHeight - 2;
      // The block's own index, as a custom cover keeps block 0 out of the nodes.
      const index = Number(nodes[atEnd ? nodes.length - 1 : topIndex]?.dataset.block ?? 0);

      if (index !== positionRef.current) {
        positionRef.current = index;
        onPosition(index);
      }
    };
    // Safari has no CSS scroll anchoring: hold the top block in place when content above it resizes.
    const restore = (): void => {
      const anchor = anchorRef.current;

      if (anchor !== null && anchor.element.isConnected) {
        const top =
          anchor.element.getBoundingClientRect().top - container.getBoundingClientRect().top;

        container.scrollTop += top - anchor.offset;
      }

      measure();
    };

    measure();
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(restore);

    observer.observe(article);

    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [parsed, fontReady, onPosition]);

  useEffect(() => {
    if (jump === null) return;

    const container = containerRef.current;

    if (container === null) return;

    container
      .querySelector<HTMLElement>(`div[data-block="${jump.index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jump]);

  // The match goes a third of the way down the screen and takes the find mark.
  useEffect(() => {
    const container = containerRef.current;
    const block = container?.querySelector(`div[data-block="${find?.index}"]`);
    const range =
      find === null || block === null || block === undefined
        ? null
        : rangeOf(block, find.start, find.end);
    const highlights = "highlights" in CSS ? CSS.highlights : null;

    if (container === null || range === null) {
      highlights?.delete("find");
      return;
    }

    const top = range.getBoundingClientRect().top - container.getBoundingClientRect().top;

    container.scrollTop += top - container.clientHeight / 3;
    highlights?.set("find", new Highlight(range));

    return () => {
      highlights?.delete("find");
    };
  }, [find]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const container = containerRef.current;
    const link = target.closest<HTMLAnchorElement>("a[data-link-block]");

    if (link !== null && container !== null) {
      event.preventDefault();

      const index = Number(link.dataset.linkBlock);

      container
        .querySelector<HTMLElement>(`div[data-block="${index}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (target.closest("a, button") !== null) return;
    if (!tap.isTap(event)) return;
    if (container === null) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;

    if (ratio < 0.3 || ratio > 0.7) {
      turnPage(container, ratio < 0.3 ? -1 : 1);
      onPageTurn();
      return;
    }

    onToggleChrome();
  };

  // Keys keep their identity when figures are inserted earlier in the book, so images do not reload.
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
        <ReaderImage bookId={bookId} imageId={imageId} ratio={block.ratio} />
      ) : null;

    return {
      index,
      key: `${base}#${count}`,
      className: blockClass(block),
      node: image ?? <MarkedText text={block.text} marks={block.marks} />,
    };
  });

  // Justified lines without hyphenation leave wide spaces between words.
  const hyphens = settings.textAlign === "justify" ? "auto" : undefined;
  // The book's own first page is its cover picture in most EPUBs: the reader's picture takes that place.
  const shown = hasCustomCover && parsed.blocks[0]?.kind === "image" ? nodes.slice(1) : nodes;

  return (
    <div
      ref={containerRef}
      data-scroller
      // The resize handler holds the top block. Browser anchoring too would move the view twice.
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      onPointerDown={tap.onPointerDown}
      onClick={handleClick}
    >
      {fontReady && (
        <article
          ref={articleRef}
          className="reader-body mx-auto max-w-prose overflow-x-clip px-6.5 pt-16 pb-[calc(7.5rem+var(--safe-bottom))] text-(--page-ink) md:max-w-[var(--text-width)]"
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
          {hasCustomCover && (
            <div className="mx-auto max-w-xs">
              <ReaderImage bookId={bookId} imageId="cover" />
            </div>
          )}
          {shown.map((entry) => (
            <div key={entry.key} data-block={entry.index} className={entry.className}>
              {entry.node}
            </div>
          ))}
        </article>
      )}
    </div>
  );
});
