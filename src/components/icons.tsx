import type { ReactElement, ReactNode } from "react";

interface IconProps {
  readonly className?: string;
}

function Icon({
  children,
  className = "size-6 md:size-5",
}: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </Icon>
  );
}

export function Bars3Icon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
    </Icon>
  );
}

export function ListBulletIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M8.25 6.75h12M8.25 12h12M8.25 17.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </Icon>
  );
}

export function BookOpenIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </Icon>
  );
}

export function AdjustmentsIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
    </Icon>
  );
}

export function Squares2x2Icon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
    </Icon>
  );
}

export function EllipsisVerticalIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
    </Icon>
  );
}

export function ChevronDownIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </Icon>
  );
}

export function AlignLeftIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M3.75 6h16.5M3.75 10h10.5M3.75 14h16.5M3.75 18h10.5" />
    </Icon>
  );
}

export function AlignJustifyIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M3.75 6h16.5M3.75 10h16.5M3.75 14h16.5M3.75 18h16.5" />
    </Icon>
  );
}

export function AlignRightIcon({ className }: IconProps): ReactElement {
  return (
    <Icon className={className}>
      <path d="M3.75 6h16.5M9.75 10h10.5M3.75 14h16.5M9.75 18h10.5" />
    </Icon>
  );
}
