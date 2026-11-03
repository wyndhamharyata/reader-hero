import { useSyncExternalStore } from "react";

// The books the app was opened with, until their reader answers. Kept in memory, so a launch that ends unanswered keeps the book.
const opened = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function markOpenedFile(id: string): void {
  opened.add(id);

  for (const listener of listeners) listener();
}

// Answered either way, so the same book never asks twice.
export function answerOpenedFile(id: string): void {
  opened.delete(id);

  for (const listener of listeners) listener();
}

export function useIsOpenedFile(id: string): boolean {
  return useSyncExternalStore(subscribe, () => opened.has(id));
}
