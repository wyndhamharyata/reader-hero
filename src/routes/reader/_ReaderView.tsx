import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { createPortal } from "react-dom";
import type { Annotation, AnnotationPoint } from "@/domain/annotation";
import { fontFamily, type Block, type ParsedBook, type ReaderSettings } from "@/domain/book";
import { MarkerIcon } from "@/components/icons";
import { containsPoint, type Anchor } from "@/use-cases/annotations";
import { NoteCard } from "./_NoteCard";
import { prefersLessMotion } from "@/lib/open-book";
import { chapterAt, chapterRange, type Span } from "@/lib/reader-window";
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
  // The book's chapters, by block, so the reader mounts only the ones near the place being read.
  chunks: ReadonlyArray<Span>;
  settings: ReaderSettings;
  initialBlock: number;
  jump: JumpRequest | null;
  onPosition: (blockIndex: number) => void;
  onToggleChrome: () => void;
  onPageTurn: () => void;
  find: FindTarget | null;
  // The book's saved highlights, painted as they are stored.
  annotations: ReadonlyArray<Annotation>;
  // A highlight the reader just made, already merged with the ones it touched.
  onHighlight: (anchor: Anchor) => Annotation;
  onSaveNote: (annotation: Annotation, note: string) => void;
  onRemoveAnnotation: (annotation: Annotation) => void;
  // A highlight the Contents list asked to open.
  focusAnnotation: { readonly id: string; readonly nonce: number } | null;
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
const topRoomPx = 80;
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

const slideMs = 200;
// How far the first run of a jump goes, as a share of the screen, before the rest is placed at once.
const slideShare = 0.3;
let slideRun = 0;
// A run moves the page itself, so the window holds still until the run ends.
let slideMoving = false;

// A short run the way the place lies, then the place itself, so a jump shows its direction.
function slideTo(container: HTMLElement, place: () => number, direction?: 1 | -1): void {
  const maxScroll = container.scrollHeight - container.clientHeight;
  const to = Math.max(0, Math.min(place(), maxScroll));
  const runPx = container.clientHeight * slideShare;
  // A jump from another chapter runs in from a share short of the place, as the page it left is gone.
  const start = direction === undefined ? container.scrollTop : to - direction * runPx;
  const from = Math.max(0, Math.min(start, maxScroll));
  const distance = to - from;

  slideRun += 1;
  slideMoving = false;

  if (prefersLessMotion() || Math.abs(distance) < 4) {
    container.scrollTop = to;
    return;
  }

  slideMoving = true;
  container.scrollTop = from;

  const id = slideRun;
  const run = Math.sign(distance) * Math.min(Math.abs(distance), runPx);
  const started = performance.now();
  const step = (now: number): void => {
    if (id !== slideRun) return;

    const t = Math.min(1, (now - started) / slideMs);

    if (t < 1) {
      container.scrollTop = from + run * (1 - (1 - t) ** 2);
      requestAnimationFrame(step);
      return;
    }

    // Measured again at the end, as the page above may have changed while the run went on.
    slideMoving = false;
    container.scrollTop = place();
  };

  requestAnimationFrame(step);
}

// The scrollTop that puts a block at the top of the page, measured when it is wanted.
const placeAt = (container: HTMLElement, node: HTMLElement) => (): number =>
  container.scrollTop + node.getBoundingClientRect().top - container.getBoundingClientRect().top;

const isBefore = (a: AnnotationPoint, b: AnnotationPoint): boolean =>
  a.block < b.block || (a.block === b.block && a.offset < b.offset);

// A point in the rendered text to its block and offset, so a DOM change does not lose the selection.
function pointOf(node: Node, offset: number): AnnotationPoint | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const block = element?.closest<HTMLElement>("div[data-block]") ?? null;

  if (block === null) return null;

  const index = Number(block.dataset.block);
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let seen = 0;

  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if (text === node) return { block: index, offset: seen + offset } as AnnotationPoint;

    seen += text.textContent?.length ?? 0;
  }

  return { block: index, offset: seen } as AnnotationPoint;
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

// The painted ranges of one highlight, cut to the mounted chapters.
function annotationRanges(
  container: HTMLElement,
  parsed: ParsedBook,
  annotation: Annotation,
  blockStart: number,
  blockEnd: number,
): Array<Range> {
  const ranges: Array<Range> = [];

  for (
    let index = Math.max(annotation.from.block, blockStart);
    index <= Math.min(annotation.to.block, blockEnd - 1);
    index += 1
  ) {
    const block = parsed.blocks[index];
    const node = container.querySelector<HTMLElement>(`div[data-block="${index}"]`);

    if (block === undefined || node === null || block.kind === "image") continue;

    const start = index === annotation.from.block ? annotation.from.offset : 0;
    const end = index === annotation.to.block ? annotation.to.offset : block.text.length;
    const range = rangeOf(node, start, end);

    if (range !== null) ranges.push(range);
  }

  return ranges;
}

// The note dot's top, in the starting block's own coordinates.
function noteDotTop(
  container: HTMLElement,
  parsed: ParsedBook,
  annotation: Annotation,
  blockStart: number,
  blockEnd: number,
): number | null {
  const index = annotation.from.block;

  if (annotation.note === undefined || index < blockStart || index >= blockEnd) return null;

  const block = parsed.blocks[index];
  const node = container.querySelector<HTMLElement>(`div[data-block="${index}"]`);

  if (block === undefined || node === null) return null;

  const range = rangeOf(node, annotation.from.offset, annotation.from.offset + 1);
  const rect = range?.getClientRects()[0];

  return rect === undefined ? null : rect.top - node.getBoundingClientRect().top;
}

// Memoised so the parent's per-position renders do not re-map every block of the book.
export const ReaderView = memo(function ReaderView({
  bookId,
  parsed,
  chunks,
  settings,
  initialBlock,
  jump,
  onPosition,
  onToggleChrome,
  onPageTurn,
  find,
  annotations,
  onHighlight,
  onSaveNote,
  onRemoveAnnotation,
  focusAnnotation,
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
  // The chapter being read, with one either side of it. A long book mounts a few hundred blocks, not all.
  const [center, setCenter] = useState(() => chapterAt(chunks, initialBlock));
  const centerRef = useRef(center);
  const jumpedRef = useRef(-1);
  const { start: blockStart, end: blockEnd } = useMemo(
    () => chapterRange(chunks, center, parsed.blocks.length),
    [chunks, center, parsed.blocks.length],
  );
  // The end of the window is only the end of the book when it holds the book's last block.
  const isBookEnd = blockEnd >= parsed.blocks.length;
  const pendingRef = useRef<number | null>(null);
  // The way a jump out of the window goes, as the window's offsets cannot tell it.
  const pendingDirection = useRef<1 | -1>(1);
  // The live selection, kept as block offsets so the DOM can change under it.
  const anchorRef2 = useRef<Anchor | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selected, setSelected] = useState<{
    readonly annotation: Annotation;
    readonly isFocused: boolean;
  } | null>(null);
  const selectedRect = useRef<{ top: number; bottom: number; left: number } | null>(null);
  const openedAt = useRef(0);
  const focusedNonce = useRef(0);
  const [dotTops, setDotTops] = useState<ReadonlyMap<number, number>>(new Map());
  const moveCenter = useCallback((chapter: number) => {
    if (chapter === centerRef.current) return;

    centerRef.current = chapter;
    setCenter(chapter);
  }, []);

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

  // Every mounted block's top, for the binary search a scroll does instead of observers.
  const measure = useCallback(() => {
    const container = containerRef.current;

    if (container === null) return;

    const nodes = Array.from(container.querySelectorAll<HTMLElement>("div[data-block]"));
    const base = container.getBoundingClientRect().top - container.scrollTop;

    blocksRef.current = {
      nodes,
      tops: nodes.map((node) => node.getBoundingClientRect().top - base),
    };
  }, []);

  // The window's blocks are measured as they mount, and the top block is held in place, both before paint.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const container = containerRef.current;
    const before = blocksRef.current;
    const at = anchor === null ? -1 : before.nodes.indexOf(anchor.element as HTMLElement);
    const heldTop = at === -1 ? null : (before.tops[at] ?? null);

    measure();

    if (anchor === null || container === null || heldTop === null) return;

    const now = blocksRef.current.nodes.indexOf(anchor.element as HTMLElement);
    const movedTop = now === -1 ? null : (blocksRef.current.tops[now] ?? null);

    if (movedTop !== null) container.scrollTop += movedTop - heldTop;
  }, [measure, blockStart, blockEnd]);

  // A scroll does a binary search, not observers: WebKit recomputes observers on every frame.
  useEffect(() => {
    const container = containerRef.current;
    const article = articleRef.current;

    if (container === null || article === null || !fontReady) return;

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

      // The top block brings a resume to the same screen. The book's own last block marks it finished.
      const atEnd = top + container.clientHeight >= container.scrollHeight - 2;
      const isLast = isBookEnd;
      // The block's own index, as a custom cover keeps block 0 out of the nodes.
      const index = Number(
        nodes[atEnd && isLast ? nodes.length - 1 : topIndex]?.dataset.block ?? 0,
      );

      if (index !== positionRef.current) {
        positionRef.current = index;
        onPosition(index);
      }

      // The window follows the reading place, and turns a page at its own end rather than running out.
      if (!slideMoving) {
        moveCenter(atEnd && !isLast ? centerRef.current + 1 : chapterAt(chunks, index));
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
  }, [parsed, chunks, fontReady, onPosition, moveCenter, isBookEnd, measure]);

  // A place in the book may be outside the window. The window moves first, then the page follows.
  const goTo = useCallback(
    (index: number) => {
      const container = containerRef.current;

      if (container === null) return;

      const target = container.querySelector<HTMLElement>(`div[data-block="${index}"]`);

      if (target === null) {
        pendingRef.current = index;
        pendingDirection.current = index < positionRef.current ? -1 : 1;
        moveCenter(chapterAt(chunks, index));
        return;
      }

      pendingRef.current = null;
      slideTo(container, placeAt(container, target));
    },
    [chunks, moveCenter],
  );

  // The match goes a third of the way down the screen and takes the find mark.
  const drawFind = useCallback((target: FindTarget | null) => {
    const container = containerRef.current;
    const block = container?.querySelector(`div[data-block="${target?.index}"]`);
    const highlights = "highlights" in CSS ? CSS.highlights : null;

    highlights?.delete("find");
    if (container === null || target === null || block === null || block === undefined) return;

    const range = rangeOf(block, target.start, target.end);

    if (range === null) return;

    const top = (): number =>
      range.getBoundingClientRect().top - container.getBoundingClientRect().top;

    slideTo(container, () => container.scrollTop + top() - container.clientHeight / 3);
    highlights?.set("find", new Highlight(range));
  }, []);

  // The block a jump, a find or a link asked for, now that its chapter is mounted.
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const container = containerRef.current;

    if (pending === null || container === null) return;

    const target = container.querySelector<HTMLElement>(`div[data-block="${pending}"]`);

    if (target === null) return;

    pendingRef.current = null;
    slideTo(container, placeAt(container, target), pendingDirection.current);

    if (find !== null && find.index === pending) drawFind(find);
  }, [center, find, drawFind]);

  // Before paint, so no frame shows the page the reader left.
  useLayoutEffect(() => {
    if (jump === null || jumpedRef.current === jump.nonce) return;

    jumpedRef.current = jump.nonce;
    goTo(jump.index);
  }, [jump, goTo]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const block = container?.querySelector(`div[data-block="${find?.index}"]`);

    // The window moves to a match in another chapter, and the scroll above finishes the visit.
    if (find !== null && (block === null || block === undefined)) {
      goTo(find.index);
      return;
    }

    drawFind(find);
  }, [find, goTo, drawFind]);

  // The first line of a highlight on screen, in client coordinates.
  const rectOf = useCallback(
    (annotation: Annotation): { top: number; bottom: number; left: number } | null => {
      const container = containerRef.current;
      const node = container?.querySelector<HTMLElement>(
        `div[data-block="${annotation.from.block}"]`,
      );
      const block = parsed.blocks[annotation.from.block];

      if (container === null || node === null || node === undefined || block === undefined) {
        return null;
      }

      const end =
        annotation.to.block === annotation.from.block ? annotation.to.offset : block.text.length;
      const range = rangeOf(node, annotation.from.offset, end);
      const rect = range?.getBoundingClientRect();

      return rect === undefined ? null : { top: rect.top, bottom: rect.bottom, left: rect.left };
    },
    [parsed],
  );

  const open = useCallback(
    (annotation: Annotation, isFocused: boolean) => {
      selectedRect.current = rectOf(annotation);
      openedAt.current = containerRef.current?.scrollTop ?? 0;
      flushSync(() => setSelected({ annotation, isFocused }));
    },
    [rectOf],
  );

  // A selection inside the article, from the first long press to the last handle drag.
  useEffect(() => {
    const update = (): void => {
      const selection = document.getSelection();
      const article = articleRef.current;

      if (
        selection === null ||
        article === null ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
      ) {
        anchorRef2.current = null;
        setHasSelection(false);
        return;
      }

      const range = selection.getRangeAt(0);

      if (!article.contains(range.commonAncestorContainer)) {
        anchorRef2.current = null;
        setHasSelection(false);
        return;
      }

      const from = pointOf(range.startContainer, range.startOffset);
      const to = pointOf(range.endContainer, range.endOffset);

      if (from === null || to === null || !isBefore(from, to)) {
        anchorRef2.current = null;
        setHasSelection(false);
        return;
      }

      anchorRef2.current = { from, to };
      setHasSelection(true);
    };

    document.addEventListener("selectionchange", update);

    return () => document.removeEventListener("selectionchange", update);
  }, []);

  // Saved highlights paint on the page, and a note puts its dot in the margin.
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (container === null) return;

    const highlights = "highlights" in CSS ? CSS.highlights : null;
    const ranges = annotations.flatMap((annotation) =>
      annotationRanges(container, parsed, annotation, blockStart, blockEnd),
    );

    if (highlights !== null) {
      if (ranges.length === 0) highlights.delete("annotation");
      else highlights.set("annotation", new Highlight(...ranges));
    }

    const tops = new Map<number, number>();

    for (const annotation of annotations) {
      const top = noteDotTop(container, parsed, annotation, blockStart, blockEnd);

      if (top !== null) tops.set(annotation.from.block, top);
    }

    setDotTops(tops);
  }, [
    annotations,
    blockStart,
    blockEnd,
    parsed,
    fontReady,
    settings.font,
    settings.fontSize,
    settings.lineHeight,
    settings.textAlign,
    settings.textWidth,
  ]);

  // A scroll takes the card away, as the reader has moved on from the passage.
  useEffect(() => {
    const container = containerRef.current;

    if (selected === null || container === null) return;

    const onScroll = (): void => {
      if (Math.abs(container.scrollTop - openedAt.current) > 40) setSelected(null);
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    return () => container.removeEventListener("scroll", onScroll);
  }, [selected]);

  // The list's Edit key: open the highlight, after its chapter mounts if it is outside the window.
  useLayoutEffect(() => {
    if (focusAnnotation === null || focusedNonce.current === focusAnnotation.nonce) return;

    const annotation = annotations.find((entry) => entry.id === focusAnnotation.id);

    if (annotation === undefined) return;

    const node = containerRef.current?.querySelector<HTMLElement>(
      `div[data-block="${annotation.from.block}"]`,
    );

    if (node === null || node === undefined) {
      goTo(annotation.from.block);
      return;
    }

    focusedNonce.current = focusAnnotation.nonce;
    open(annotation, true);
  }, [focusAnnotation, annotations, goTo, open, blockStart, blockEnd, center]);

  // A point inside one of the highlight's drawn lines, not only its text.
  const hits = useCallback(
    (annotation: Annotation, x: number, y: number): boolean => {
      const container = containerRef.current;

      if (container === null) return false;

      for (let index = annotation.from.block; index <= annotation.to.block; index += 1) {
        const block = parsed.blocks[index];
        const node = container.querySelector<HTMLElement>(`div[data-block="${index}"]`);

        if (block === undefined || node === null || block.kind === "image") continue;

        const start = index === annotation.from.block ? annotation.from.offset : 0;
        const end = index === annotation.to.block ? annotation.to.offset : block.text.length;
        const range = rangeOf(node, start, end);
        const inside =
          range !== null &&
          Array.from(range.getClientRects()).some(
            (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
          );

        if (inside) return true;
      }

      return false;
    },
    [parsed],
  );

  const makeHighlight = (): void => {
    const anchor = anchorRef2.current;

    if (anchor === null) return;

    const annotation = onHighlight(anchor);

    document.getSelection()?.removeAllRanges();
    anchorRef2.current = null;
    setHasSelection(false);
    open(annotation, true);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a[data-link-block]");

    if (link !== null) {
      event.preventDefault();
      goTo(Number(link.dataset.linkBlock));
      return;
    }

    const container = containerRef.current;

    if (target.closest("a, button") !== null) return;
    if (!tap.isTap(event)) return;
    if (container === null) return;

    // A tap on a saved highlight opens its note, before any page turn.
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
    const point = caret === null ? null : pointOf(caret.startContainer, caret.startOffset);
    const hit =
      point === null
        ? undefined
        : annotations.find(
            (annotation) =>
              containsPoint(annotation, point) && hits(annotation, event.clientX, event.clientY),
          );

    if (hit !== undefined) {
      event.preventDefault();
      open(hit, false);
      return;
    }

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
  const nodes = parsed.blocks.slice(blockStart, blockEnd).map((block, offset) => {
    const index = blockStart + offset;
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
  const isCoverPage = hasCustomCover && blockStart === 0 && parsed.blocks[0]?.kind === "image";
  const shown = isCoverPage ? nodes.slice(1) : nodes;

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
          className="reader-body mx-auto max-w-prose overflow-x-clip px-6.5 pt-20 pb-[calc(7.5rem+var(--safe-bottom))] text-(--page-ink) md:max-w-[var(--text-width)]"
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
          {isCoverPage && (
            <div className="mx-auto max-w-xs">
              <ReaderImage bookId={bookId} imageId="cover" />
            </div>
          )}
          {shown.map((entry) => (
            <div key={entry.key} data-block={entry.index} className={`relative ${entry.className}`}>
              {entry.node}
              {dotTops.has(entry.index) && (
                <span
                  className="note-dot"
                  style={{ top: dotTops.get(entry.index) }}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </article>
      )}
      {hasSelection && selected === null && (
        <button type="button" className="key green highlight-pill" onClick={makeHighlight}>
          <MarkerIcon className="icon" />
          Highlight
        </button>
      )}
      {selected !== null &&
        selectedRect.current !== null &&
        createPortal(
          <NoteCard
            key={selected.annotation.id}
            annotation={selected.annotation}
            rect={selectedRect.current}
            isFocused={selected.isFocused}
            onSave={(note) => onSaveNote(selected.annotation, note)}
            onRemove={() => {
              onRemoveAnnotation(selected.annotation);
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />,
          document.body,
        )}
    </div>
  );
});
