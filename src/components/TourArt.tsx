import type { ReactElement } from "react";
import type { TourArt as Art } from "@/lib/tour";

interface Props {
  readonly name: Art;
  readonly className?: string;
}

// One drawing per tour step, so a card shows what it means before it says it.
export function TourArt({ name, className }: Props): ReactElement | null {
  if (name === "reflow") return <Reflow className={className} />;
  if (name === "shelf") return <Shelf className={className} />;
  if (name === "share") return <Share className={className} />;
  if (name === "book") return <Book className={className} />;
  return <ReaderPhone className={className} />;
}

function Reflow({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 96"
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
    >
      <rect
        x="8"
        y="14"
        width="112"
        height="68"
        rx="8"
        className="text-base-content/25"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M20 30h86M20 38h74M20 46h82M20 54h68M20 62h80M20 70h56"
        className="text-base-content/25"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M136 48h30M160 42l6 6-6 6"
        className="text-primary"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <rect
        x="200"
        y="14"
        width="112"
        height="68"
        rx="8"
        className="text-primary/40"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M212 32h88"
        className="text-primary motion-safe:animate-tour-line"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="96"
      />
      <path
        d="M212 45h72"
        className="text-base-content/45 motion-safe:animate-tour-line"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="96"
        style={{ animationDelay: "140ms" }}
      />
      <path
        d="M212 58h80"
        className="text-base-content/45 motion-safe:animate-tour-line"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="96"
        style={{ animationDelay: "280ms" }}
      />
      <path
        d="M212 71h44"
        className="text-base-content/45 motion-safe:animate-tour-line"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="96"
        style={{ animationDelay: "420ms" }}
      />
    </svg>
  );
}

function Shelf({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 96"
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
    >
      <g className="text-base-content/25" stroke="currentColor">
        <rect x="24" y="26" width="112" height="44" rx="8" strokeWidth="2" />
        <rect x="34" y="36" width="24" height="24" rx="4" strokeWidth="2" />
        <path d="M68 42h56M68 54h40" strokeWidth="2.5" />
      </g>
      <g className="text-primary" stroke="currentColor">
        <circle cx="160" cy="48" r="13" strokeWidth="2" />
        <path d="M160 42v12M154 48h12" strokeWidth="2.5" />
      </g>
      <g className="text-primary motion-safe:animate-tour-drop">
        <rect x="188" y="26" width="112" height="44" rx="8" stroke="currentColor" strokeWidth="2" />
        <rect x="198" y="36" width="24" height="24" rx="4" fill="currentColor" opacity="0.18" />
        <path d="M232 42h56M232 54h40" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
      </g>
    </svg>
  );
}

function Share({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 96"
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="118"
        y="6"
        width="84"
        height="84"
        rx="12"
        className="text-base-content/25"
        stroke="currentColor"
        strokeWidth="2"
      />
      <g className="text-primary" stroke="currentColor" strokeWidth="2.5">
        <path d="M160 62V26" />
        <path d="M148 38l12-12 12 12" />
        <path d="M136 58v14h48V58" />
      </g>
      <g className="text-base-content/25" stroke="currentColor" strokeWidth="2">
        <path d="M134 76h52" />
      </g>
    </svg>
  );
}

function Book({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 96"
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M160 25c-14-8-32-11-52-11H92v56h16c20 0 38 5 52 12"
        className="text-base-content/30"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M160 25c14-8 32-11 52-11h16v56h-16c-20 0-38 5-52 12"
        className="text-base-content/30"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path d="M160 25v57" className="text-base-content/30" stroke="currentColor" strokeWidth="2" />
      <path
        d="M198 16v24l7-6 7 6V16"
        className="text-primary"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function ReaderPhone({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 96"
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
    >
      <defs>
        <clipPath id="tour-phone">
          <rect x="132" y="6" width="56" height="84" rx="10" />
        </clipPath>
      </defs>
      <path
        d="M142 24h36M142 34h28M142 44h36M142 54h22"
        className="text-base-content/25"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <g clipPath="url(#tour-phone)">
        <g className="text-primary motion-safe:animate-tour-bars">
          <rect x="136" y="64" width="48" height="16" rx="6" fill="currentColor" opacity="0.16" />
          <rect
            x="136"
            y="64"
            width="48"
            height="16"
            rx="6"
            stroke="currentColor"
            strokeWidth="2"
          />
        </g>
      </g>
      <rect
        x="132"
        y="6"
        width="56"
        height="84"
        rx="10"
        className="text-base-content/25"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
