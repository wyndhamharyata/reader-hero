import type { ParseState } from "@/domain/book";

export const offlineBadge = "badge badge-ghost badge-sm";

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
