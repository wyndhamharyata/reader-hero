import type { ReactElement } from "react";
import type { TourArt as Art } from "@/lib/tour";

interface Props {
  readonly name: Art;
  readonly className?: string;
}

// One drawing per tour step, so a card shows what it means before it says it.
export function TourArt({ name, className }: Props): ReactElement | null {
  if (name === "hero") return <Hero className={className} />;
  if (name === "shelf") return <Shelf className={className} />;
  if (name === "share") return <Share className={className} />;
  if (name === "book") return <Book className={className} />;
  if (name === "contents") return <Contents className={className} />;
  return <ReaderPhone className={className} />;
}

function Hero({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 140" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tour-hero-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--color-secondary)" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="tour-hero-cover-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="tour-hero-cover-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-secondary)" />
          <stop offset="1" stopColor="var(--color-secondary)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="tour-hero-rule" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-primary)" />
          <stop offset="1" stopColor="var(--color-secondary)" />
        </linearGradient>
      </defs>
      <rect width="320" height="140" rx="16" fill="url(#tour-hero-sky)" />
      <circle cx="30" cy="116" r="26" fill="var(--color-primary)" opacity="0.18" />
      <circle cx="292" cy="24" r="28" fill="var(--color-secondary)" opacity="0.16" />
      <ellipse cx="157" cy="132" rx="46" ry="6" fill="var(--color-base-content)" opacity="0.12" />
      <g transform="rotate(-9 92 74)">
        <rect x="62" y="30" width="56" height="80" rx="8" fill="url(#tour-hero-cover-a)" />
        <rect
          x="70"
          y="40"
          width="30"
          height="5"
          rx="2.5"
          fill="var(--color-accent-content)"
          opacity="0.85"
        />
        <rect
          x="70"
          y="52"
          width="40"
          height="4"
          rx="2"
          fill="var(--color-accent-content)"
          opacity="0.55"
        />
        <circle cx="98" cy="92" r="9" fill="var(--color-accent-content)" opacity="0.4" />
      </g>
      <g transform="rotate(8 228 74)">
        <rect x="202" y="30" width="56" height="80" rx="8" fill="url(#tour-hero-cover-b)" />
        <circle cx="230" cy="58" r="13" fill="var(--color-secondary-content)" opacity="0.6" />
        <rect
          x="214"
          y="82"
          width="32"
          height="4"
          rx="2"
          fill="var(--color-secondary-content)"
          opacity="0.55"
        />
        <rect
          x="214"
          y="92"
          width="22"
          height="4"
          rx="2"
          fill="var(--color-secondary-content)"
          opacity="0.4"
        />
      </g>
      <rect
        x="119"
        y="7"
        width="76"
        height="120"
        rx="14"
        fill="var(--color-base-100)"
        stroke="var(--color-base-300)"
        strokeWidth="2"
      />
      <rect
        x="130"
        y="20"
        width="42"
        height="7"
        rx="3.5"
        fill="var(--color-base-content)"
        opacity="0.75"
      />
      <g fill="var(--color-base-content)" opacity="0.28">
        <rect x="130" y="36" width="54" height="4" rx="2" />
        <rect x="130" y="45" width="48" height="4" rx="2" />
        <rect x="130" y="54" width="54" height="4" rx="2" />
        <rect x="130" y="63" width="34" height="4" rx="2" />
      </g>
      <rect
        x="130"
        y="76"
        width="54"
        height="26"
        rx="6"
        fill="var(--color-primary)"
        opacity="0.2"
      />
      <g fill="var(--color-primary)" opacity="0.6">
        <rect x="136" y="83" width="34" height="3.5" rx="1.75" />
        <rect x="136" y="91" width="42" height="3.5" rx="1.75" />
      </g>
      <rect x="130" y="110" width="54" height="6" rx="3" fill="var(--color-base-300)" />
      <rect x="130" y="110" width="34" height="6" rx="3" fill="url(#tour-hero-rule)" />
    </svg>
  );
}

function Shelf({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 96" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tour-shelf-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-warning)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect width="320" height="96" rx="16" fill="url(#tour-shelf-bg)" />
      <rect
        x="24"
        y="78"
        width="272"
        height="8"
        rx="4"
        fill="var(--color-base-content)"
        opacity="0.14"
      />
      <g>
        <rect x="40" y="26" width="34" height="52" rx="6" fill="var(--color-accent)" />
        <rect
          x="46"
          y="32"
          width="6"
          height="40"
          rx="3"
          fill="var(--color-accent-content)"
          opacity="0.4"
        />
        <rect x="84" y="18" width="34" height="60" rx="6" fill="var(--color-secondary)" />
        <rect
          x="90"
          y="24"
          width="6"
          height="48"
          rx="3"
          fill="var(--color-secondary-content)"
          opacity="0.4"
        />
        <rect x="128" y="30" width="34" height="48" rx="6" fill="var(--color-warning)" />
        <rect
          x="134"
          y="36"
          width="6"
          height="36"
          rx="3"
          fill="var(--color-warning-content)"
          opacity="0.45"
        />
      </g>
      <g className="motion-safe:animate-tour-drop">
        <rect x="196" y="14" width="36" height="64" rx="6" fill="var(--color-primary)" />
        <rect
          x="203"
          y="21"
          width="6"
          height="50"
          rx="3"
          fill="var(--color-primary-content)"
          opacity="0.45"
        />
        <circle cx="214" cy="40" r="8" fill="var(--color-primary-content)" opacity="0.5" />
      </g>
      <circle cx="262" cy="28" r="6" fill="var(--color-primary)" opacity="0.35" />
      <circle cx="284" cy="50" r="4" fill="var(--color-secondary)" opacity="0.4" />
    </svg>
  );
}

function Share({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 96" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tour-share-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-secondary)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <rect width="320" height="96" rx="16" fill="url(#tour-share-bg)" />
      <rect
        x="120"
        y="6"
        width="80"
        height="84"
        rx="12"
        fill="var(--color-base-100)"
        stroke="var(--color-base-300)"
        strokeWidth="2"
      />
      <g>
        <rect x="131" y="16" width="14" height="14" rx="4" fill="var(--color-accent)" />
        <rect x="151" y="16" width="14" height="14" rx="4" fill="var(--color-secondary)" />
        <rect x="171" y="16" width="14" height="14" rx="4" fill="var(--color-warning)" />
        <rect x="131" y="34" width="14" height="14" rx="4" fill="var(--color-info)" />
        <rect
          x="151"
          y="34"
          width="14"
          height="14"
          rx="4"
          fill="var(--color-primary)"
          opacity="0.45"
        />
        <rect x="171" y="34" width="14" height="14" rx="4" fill="var(--color-base-300)" />
      </g>
      <circle cx="160" cy="62" r="17" fill="var(--color-primary)" />
      <path
        d="M160 71V54M154 60l6-7 6 7M152 71h16"
        fill="none"
        stroke="var(--color-primary-content)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Book({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 96" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tour-book-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--color-warning)" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect width="320" height="96" rx="16" fill="url(#tour-book-bg)" />
      <ellipse cx="160" cy="86" rx="68" ry="5" fill="var(--color-base-content)" opacity="0.12" />
      <path
        d="M160 24c-14-8-32-11-52-11H92v58h16c20 0 38 5 52 12z"
        fill="var(--color-base-100)"
        stroke="var(--color-base-300)"
        strokeWidth="2"
      />
      <path
        d="M160 24c14-8 32-11 52-11h16v58h-16c-20 0-38 5-52 12z"
        fill="var(--color-base-200)"
        stroke="var(--color-base-300)"
        strokeWidth="2"
      />
      <path d="M160 24v59" fill="none" stroke="var(--color-base-300)" strokeWidth="2" />
      <g fill="var(--color-base-content)" opacity="0.24">
        <rect x="102" y="26" width="40" height="4" rx="2" />
        <rect x="102" y="35" width="34" height="4" rx="2" />
        <rect x="102" y="44" width="42" height="4" rx="2" />
      </g>
      <rect
        x="188"
        y="26"
        width="44"
        height="26"
        rx="5"
        fill="var(--color-primary)"
        opacity="0.4"
      />
      <g fill="var(--color-base-content)" opacity="0.24">
        <rect x="188" y="58" width="46" height="4" rx="2" />
        <rect x="188" y="67" width="30" height="4" rx="2" />
      </g>
      <path d="M198 14v26l7-6 7 6V14z" fill="var(--color-primary)" />
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
        <linearGradient id="tour-reader-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-secondary)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.18" />
        </linearGradient>
        <clipPath id="tour-phone">
          <rect x="132" y="6" width="56" height="84" rx="10" />
        </clipPath>
      </defs>
      <rect width="320" height="96" rx="16" fill="url(#tour-reader-bg)" />
      <rect x="132" y="6" width="56" height="84" rx="10" fill="var(--color-base-100)" />
      <rect
        x="146"
        y="2"
        width="56"
        height="84"
        rx="10"
        fill="var(--color-base-300)"
        opacity="0.35"
      />
      <rect x="142" y="14" width="24" height="4" rx="2" fill="var(--color-primary)" opacity="0.7" />
      <path
        d="M142 24h36M142 34h28M142 44h36M142 54h22"
        className="text-base-content/30"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <g clipPath="url(#tour-phone)">
        <g className="text-primary motion-safe:animate-tour-bars">
          <rect x="136" y="64" width="48" height="16" rx="6" fill="currentColor" opacity="0.22" />
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

function Contents({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 320 96" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tour-contents-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect width="320" height="96" rx="16" fill="url(#tour-contents-bg)" />
      <rect
        x="60"
        y="6"
        width="200"
        height="84"
        rx="12"
        fill="var(--color-base-100)"
        stroke="var(--color-base-300)"
        strokeWidth="2"
      />
      <rect x="150" y="12" width="20" height="4" rx="2" fill="var(--color-base-300)" />
      <rect
        x="72"
        y="26"
        width="80"
        height="6"
        rx="3"
        fill="var(--color-base-content)"
        opacity="0.55"
      />
      <g fill="var(--color-base-content)" opacity="0.22">
        <rect x="72" y="42" width="120" height="5" rx="2.5" />
        <rect x="72" y="56" width="100" height="5" rx="2.5" />
        <rect x="72" y="70" width="110" height="5" rx="2.5" />
      </g>
      <rect
        x="198"
        y="38"
        width="52"
        height="16"
        rx="8"
        fill="var(--color-primary)"
        opacity="0.3"
      />
      <rect x="198" y="62" width="44" height="16" rx="8" fill="var(--color-accent)" opacity="0.3" />
    </svg>
  );
}
