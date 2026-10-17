export const settingsHeading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

export type GroupingState =
  | { readonly left: number }
  | { readonly books: number; readonly series: number }
  | { readonly error: string }
  | null;
