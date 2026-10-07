import type { ReactElement } from "react";
import { Link, useNavigate, type LinkProps } from "react-router";
import { slideTo } from "@/lib/slide-to";

// A plain click slides; a modified one, such as a new tab, keeps the link's own behaviour.
export function SlideLink({
  to,
  direction,
  ...rest
}: Omit<LinkProps, "to" | "onClick"> & { to: string; direction: "in" | "out" }): ReactElement {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      {...rest}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        slideTo(navigate, to, direction);
      }}
    />
  );
}
