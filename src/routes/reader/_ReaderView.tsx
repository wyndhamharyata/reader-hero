import { useEffect, useRef } from "react";
import type { Block, ParsedBook, ReaderSettings } from "@/domain/book";
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

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    container
      .querySelector<HTMLElement>(`[data-block="${initialBlock}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [initialBlock]);

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

  const nodes = parsed.blocks.map((block, index) => {
    const imageId = block.imageId;
    const image =
      block.kind === "image" && imageId !== undefined ? (
        <ReaderImage key={index} bookId={bookId} imageId={imageId} />
      ) : null;
    return { index, className: blockClass(block), node: image ?? block.text };
  });

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overscroll-contain"
      onClick={handleClick}
    >
      <article
        className="reader-body mx-auto max-w-prose px-5 pt-4 pb-40"
        data-font={settings.font}
        style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}
      >
        {nodes.map((entry) => (
          <div key={entry.index} data-block={entry.index} className={entry.className}>
            {entry.node}
          </div>
        ))}
      </article>
    </div>
  );
}
