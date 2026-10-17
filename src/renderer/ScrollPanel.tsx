import type { ReactNode } from "react";

export function ScrollPanel({
  as: Element,
  className,
  children,
  inert,
  "aria-hidden": ariaHidden,
}: {
  as: "main" | "aside" | "div";
  className: string;
  children: ReactNode;
  inert?: boolean;
  "aria-hidden"?: boolean;
}) {
  return (
    <Element
      className={`${className} scroll-panel`}
      inert={inert}
      aria-hidden={ariaHidden}
    >
      <div className="scroll-panel-content">{children}</div>
    </Element>
  );
}
