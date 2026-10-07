import { useRef, useState, type ReactElement } from "react";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

interface Props {
  // Null adds a new entry.
  entry: { name: string; note: string } | null;
  story: boolean;
  onSave: (next: { name: string; note: string }) => void;
  onRemove: () => void;
  onClose: () => void;
}

// One entry at a time over the summary, so the list itself holds no form.
export function NameSheet({ entry, story, onSave, onRemove, onClose }: Props): ReactElement {
  const sheetRef = useRef<HTMLFormElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [name, setName] = useState(entry?.name ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const label = story ? "Character" : "Term";

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close"
        onClick={() => dismiss()}
      />
      <form
        ref={sheetRef}
        role="dialog"
        aria-label={label}
        className="relative z-10 flex w-full flex-col gap-2 rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:w-96 md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") return;
          onSave({ name: name.trim(), note: note.trim() });
          dismiss();
        }}
      >
        <div className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">{label}</p>
        <input
          type="text"
          className="input w-full text-base md:text-sm md:input-sm"
          placeholder="Name"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          className="textarea w-full text-base md:text-sm md:textarea-sm"
          rows={3}
          placeholder="Note"
          aria-label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {entry === null && (
          <p className="text-xs opacity-60">With no note, the next update writes one.</p>
        )}
        <div className="mt-1 flex gap-2">
          {entry !== null && (
            <button
              type="button"
              className="btn btn-ghost text-error md:btn-sm"
              onClick={() => {
                onRemove();
                dismiss();
              }}
            >
              Remove
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn btn-ghost md:btn-sm" onClick={() => dismiss()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary md:btn-sm" disabled={name.trim() === ""}>
            {entry === null ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
