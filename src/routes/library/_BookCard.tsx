import { useEffect, useState } from "react";
import { Link } from "react-router";
import { EllipsisVerticalIcon } from "@/components/icons";
import { BookMeta } from "@/domain/book";
import { parseStateBadge, readingBadge } from "@/lib/badges";
import { formatPercent, formatSize } from "@/lib/format";
import { forkApp, stopFiber } from "@/lib/hooks";
import { watchBookImage } from "@/use-cases/book-image";

interface Props {
  book: BookMeta;
  grid: boolean;
  percent: number;
  status: keyof typeof readingBadge;
  clipStart: boolean;
  onRemove: (id: string) => void;
  onReparse: (id: string) => void;
}

export function BookCard({ book, grid, percent, status, clipStart, onRemove, onReparse }: Props) {
  const [cover, setCover] = useState<string | null>(null);
  const author = book.author ?? "";
  const badge =
    book.parseState === "ready" ? readingBadge[status] : parseStateBadge[book.parseState];
  const href = `/book/${book.id}`;
  // A right-to-left box puts the ellipsis at the start; the <bdi> keeps the title itself
  // left-to-right, so punctuation such as "Vol. 7" stays in order.
  const startClip = "truncate text-left [direction:rtl]";
  const titleText = clipStart ? <bdi dir="ltr">{book.title}</bdi> : book.title;

  useEffect(() => {
    let url: string | null = null;
    const fiber = forkApp(
      watchBookImage(book.id, "cover", (image) => {
        if (image === null) return;
        if (url !== null) URL.revokeObjectURL(url);
        url = URL.createObjectURL(image.blob);
        setCover(url);
      }),
    );
    return () => {
      stopFiber(fiber);
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [book.id]);

  const coverNode =
    cover === null ? (
      <div className="aspect-[2/3] w-full animate-pulse rounded-box bg-base-300" />
    ) : (
      <img
        src={cover}
        alt=""
        className="aspect-[2/3] w-full rounded-box bg-white object-cover object-top shadow-sm"
      />
    );

  if (grid) {
    return (
      <li className="flex min-w-0 flex-col gap-2">
        <Link to={href} className="relative block">
          {coverNode}
          <span className={`${badge.className} absolute top-2 left-2`}>{badge.label}</span>
        </Link>
        <div className="flex items-end gap-1">
          <Link to={href} className="min-w-0 flex-1">
            <h2 className={`text-sm font-semibold ${clipStart ? startClip : "line-clamp-2"}`}>
              {titleText}
            </h2>
            {author !== "" && <p className="truncate text-xs opacity-70">{author}</p>}
            <p className="text-xs opacity-60">{formatPercent(percent)}</p>
          </Link>
          <div className="dropdown dropdown-end dropdown-top md:dropdown-bottom">
            {/* Safari does not focus a tapped <button>, so the trigger is a focusable div. */}
            <div
              tabIndex={0}
              role="button"
              className="btn btn-square btn-ghost btn-xs"
              aria-label="Book actions"
            >
              <EllipsisVerticalIcon className="size-5 md:size-4" />
            </div>
            <ul
              tabIndex={0}
              className="menu dropdown-content z-10 w-32 rounded-box bg-base-100 p-1 shadow"
            >
              <li>
                <button type="button" onClick={() => onReparse(book.id)}>
                  Rebuild
                </button>
              </li>
              <li>
                <button type="button" className="text-error" onClick={() => onRemove(book.id)}>
                  Delete
                </button>
              </li>
            </ul>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="card bg-base-200">
      <div className="card-body flex-row gap-3 p-3">
        <Link to={href} className="w-16 shrink-0">
          {coverNode}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <Link to={href} className="min-w-0 flex-1">
              <h2 className={`text-lg font-semibold ${clipStart ? startClip : "truncate"}`}>
                {titleText}
              </h2>
              {author !== "" && <p className="truncate text-sm opacity-70">{author}</p>}
            </Link>
            <span className={badge.className}>{badge.label}</span>
          </div>

          <p className="text-xs opacity-60">
            {book.pageCount} pages · {formatSize(book.fileSize)} · {formatPercent(percent)}
            {book.figuresPending && " · rendering figures…"}
          </p>

          <div className="mt-auto card-actions justify-end">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onReparse(book.id)}
            >
              Rebuild
            </button>
            <button
              type="button"
              className="btn btn-ghost text-error btn-xs"
              onClick={() => onRemove(book.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
