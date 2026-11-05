import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { TrashIcon } from "@/components/icons";
import type { Annotation } from "@/domain/annotation";
import { useVisualBottom } from "@/lib/use-visual-bottom";

const SAVE_DELAY_MS = 400;
// The keyboard takes about this much of the screen, and the card stays above it either way.
const CARD_WIDTH = 350;

export interface CardRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

// The note card: small, over the page, gone on a scroll. Never a sheet.
export function NoteCard({
  annotation,
  rect,
  isFocused,
  onSave,
  onRemove,
  onClose,
}: {
  readonly annotation: Annotation;
  readonly rect: CardRect;
  readonly isFocused: boolean;
  readonly onSave: (note: string) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const [note, setNote] = useState(annotation.note ?? "");
  const [armed, setArmed] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef(note);
  const savedRef = useRef(annotation.note ?? "");
  const timerRef = useRef<number | null>(null);
  const covered = useVisualBottom(true);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (noteRef.current === savedRef.current) return;

    savedRef.current = noteRef.current;
    onSave(noteRef.current);
  }, [onSave]);

  useEffect(() => flush, [flush]);

  // In the tap's own task, so iOS raises the keyboard with the card.
  useLayoutEffect(() => {
    if (!isFocused) return;

    fieldRef.current?.focus({ preventScroll: true });
  }, [isFocused]);

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (cardRef.current?.contains(event.target as Node) === true) return;

      flush();
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;

      event.stopPropagation();
      flush();
      onClose();
    };

    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [flush, onClose]);

  // Below the highlight when it fits, otherwise above the keyboard, so the page never moves.
  useLayoutEffect(() => {
    const element = cardRef.current;

    if (element === null) return;

    const bottom = window.innerHeight - covered;
    const height = element.offsetHeight;
    const width = Math.min(CARD_WIDTH, window.innerWidth - 24);
    const below = rect.bottom + 10;
    const top = below + height <= bottom ? below : Math.max(8, bottom - height - 12);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));

    setStyle({ top, left });
  }, [rect, note, covered]);

  return (
    <div ref={cardRef} className="note-card" role="dialog" aria-label="Highlight" style={style}>
      <p className="note-quote">{annotation.quote[0] ?? ""}</p>
      <div className="note-row">
        <textarea
          ref={fieldRef}
          className="note-text"
          aria-label="Note"
          rows={1}
          value={note}
          onChange={(event) => {
            const next = event.target.value;

            setNote(next);
            noteRef.current = next;

            if (timerRef.current !== null) window.clearTimeout(timerRef.current);

            timerRef.current = window.setTimeout(flush, SAVE_DELAY_MS);
          }}
        />
        <button
          type="button"
          className={armed ? "key small square danger" : "key small square danger-outline"}
          aria-label={armed ? "Remove highlight" : "Delete highlight"}
          onClick={() => {
            // A note is the reader's writing, so its delete takes a second tap.
            if (note.trim() !== "" && !armed) {
              setArmed(true);
              window.setTimeout(() => setArmed(false), 3000);
              return;
            }

            flush();
            onRemove();
          }}
        >
          <TrashIcon className="icon" />
        </button>
      </div>
    </div>
  );
}
