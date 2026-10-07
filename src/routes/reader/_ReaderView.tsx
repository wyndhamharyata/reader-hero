import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Block, ParsedBook, ReaderSettings } from "@/domain/book";
import { slideReady } from "@/lib/slide-to";
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

const fontFamily = {
  serif: "Literata Variable",
  sans: "Atkinson Hyperlegible Next Variable",
  mono: "Atkinson Hyperlegible Mono Variable",
};

// Memoised so the parent's per-position renders do not re-map every block of the book.
export const ReaderView = memo(function ReaderView({
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
  // Every block's top edge in content coordinates, read once per layout change.
  const blocksRef = useRef<{ nodes: HTMLElement[]; tops: number[] }>({ nodes: [], tops: [] });
  const anchorRef = useRef<{ element: Element; offset: number } | null>(null);
  const positionRef = useRef(-1);
  const restoredRef = useRef(false);

  // The text waits for its font: painted in the fallback font first, it reflows when the real one
  // arrives, and WebKit has no scroll anchoring to hold the restored position through that.
  const fontSpec = `1em "${fontFamily[settings.font]}"`;
  const [fontReady, setFontReady] = useState(() => document.fonts.check(fontSpec));
  useEffect(() => {
    if (fontReady || document.fonts.check(fontSpec)) {
      setFontReady(true);
      return;
    }
    let active = true;
    const show = (): void => {
      if (active) setFontReady(true);
    };
    // A font that never loads must not hold the book back.
    const timer = window.setTimeout(show, 1500);
    void document.fonts.load(fontSpec).then(show, show);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fontSpec, fontReady]);

  // Before paint, so no frame shows the top; only the first open, as figures landing later must not move it.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || restoredRef.current || !fontReady) return;
    const target = container.querySelector<HTMLElement>(`[data-block="${initialBlock}"]`);
    if (target === null) return;
    restoredRef.current = true;
    // Not scrollIntoView: under the library while the book opens, it also scrolled the library.
    container.scrollTop +=
      target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [initialBlock, fontReady]);

  // An opening book shows once the images on its first screen are read and decoded, so none pops in.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || !fontReady) return;
    let active = true;
    const box = container.getBoundingClientRect();
    const wait = async (): Promise<void> => {
      for (;;) {
        const shown = Array.from(container.querySelectorAll("[data-pending], img")).filter(
          (node) => {
            const rect = node.getBoundingClientRect();
            return rect.bottom > box.top && rect.top < box.bottom;
          },
        );
        if (!shown.some((node) => node.hasAttribute("data-pending"))) {
          await Promise.all(
            shown.map((image) => (image as HTMLImageElement).decode().catch(() => undefined)),
          );
          break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!active) return;
      }
      if (active) slideReady();
    };
    void wait();
    return () => {
      active = false;
    };
  }, [fontReady]);

  // One pass of layout reads per layout change; a scroll then does a binary search instead of a hit
  // test, and no observer watches every block (WebKit recomputes those on every frame).
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;
    if (container === null || article === null || !fontReady) return;

    const measure = (): void => {
      const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-block]"));
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
      const topIndex = indexAt(top + 8);
      const node = nodes[topIndex];
      const nodeTop = tops[topIndex];
      if (node !== undefined && nodeTop !== undefined) {
        anchorRef.current = { element: node, offset: nodeTop - top };
      }
      // The position is the top block: a resume puts the saved block at the top, so it shows the
      // same screen. At the end of the book it is the last block, so the shelf can mark it finished.
      const atEnd = top + container.clientHeight >= container.scrollHeight - 2;
      const index = atEnd ? nodes.length - 1 : topIndex;
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
      .querySelector<HTMLElement>(`[data-block="${jump.index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jump]);

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
        <ReaderImage bookId={bookId} imageId={imageId} ratio={block.ratio} />
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

  // The engine's own scroll anchoring is off: the resize handler above keeps the top block in
  // place, and with both active a figure loading above the position moves the view twice.
  return (
    <div
      ref={containerRef}
      data-scroller
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      onClick={handleClick}
    >
      {fontReady && (
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
      )}
    </div>
  );
});
