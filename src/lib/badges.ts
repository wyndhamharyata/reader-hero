import type { ParseState } from "@/domain/book";

export const pageBadge = "badge badge-neutral badge-sm";

export const parseStateBadge: Record<
  ParseState,
  { readonly label: string; readonly className: string }
> = {
  pending: { label: "Waiting", className: "badge badge-sm badge-neutral" },
  parsing: { label: "Building reader", className: "badge badge-sm badge-info" },
  ready: { label: "Ready", className: "badge badge-sm badge-success" },
  scanned: { label: "Scanned", className: "badge badge-sm badge-warning" },
  failed: { label: "Failed", className: "badge badge-sm badge-error" },
};

// A ready book shows where you are in it instead of "Ready", which says nothing once a book works.
export const readingBadge: Record<
  "not-started" | "reading" | "finished",
  { readonly label: string; readonly className: string }
> = {
  "not-started": { label: "Not started", className: "badge badge-sm badge-ghost" },
  reading: { label: "Reading", className: "badge badge-sm badge-info" },
  finished: { label: "Finished", className: "badge badge-sm badge-success" },
};
