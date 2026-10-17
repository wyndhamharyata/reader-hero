import type { ReactElement } from "react";
import { ArrowUpIcon } from "@/components/icons";

const field = "input w-full font-sans text-base md:input-sm md:text-sm";
const button = "btn md:btn-sm";

export function SummaryAskForm({
  question,
  onQuestion,
  onAsk,
  hasProvider,
  hasSummary,
  isRunning,
  isAsking,
}: {
  readonly question: string;
  readonly onQuestion: (question: string) => void;
  readonly onAsk: () => void;
  readonly hasProvider: boolean;
  readonly hasSummary: boolean;
  readonly isRunning: boolean;
  readonly isAsking: boolean;
}): ReactElement {
  const isBlocked = !hasProvider || !hasSummary || isRunning || isAsking;

  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAsk();
      }}
    >
      <input
        type="text"
        className={field}
        placeholder="Ask about the book"
        aria-label="Ask about the book"
        value={question}
        disabled={isBlocked}
        onChange={(event) => onQuestion(event.target.value)}
      />
      <button
        type="submit"
        className={`${button} btn-square btn-primary`}
        aria-label="Send"
        title="Send"
        disabled={isBlocked || question.trim() === ""}
      >
        <ArrowUpIcon className="size-6 md:size-4" />
      </button>
    </form>
  );
}
