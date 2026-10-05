import { Link } from "react-router";
import { BookMeta } from "@/domain/book";
import { parseStateBadge } from "@/lib/badges";
import { formatSize } from "@/lib/format";

interface Props {
  book: BookMeta;
  onRemove: (id: string) => void;
  onReparse: (id: string) => void;
}

export function BookCard({ book, onRemove, onReparse }: Props) {
  const author = book.author ?? "";
  const badge = parseStateBadge[book.parseState];

  return (
    <li className="card bg-base-200">
      <div className="card-body gap-3">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/book/${book.id}`} className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{book.title}</h2>
            {author !== "" && <p className="truncate text-sm opacity-70">{author}</p>}
          </Link>
          <span className={badge.className}>{badge.label}</span>
        </div>

        <p className="text-xs opacity-60">
          {book.pageCount} pages · {formatSize(book.fileSize)}
          {book.figuresPending && " · rendering figures…"}
        </p>

        <div className="card-actions justify-end">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onReparse(book.id)}>
            Rebuild
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs text-error"
            onClick={() => onRemove(book.id)}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
