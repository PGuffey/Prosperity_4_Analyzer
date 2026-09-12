import type { CSSProperties, ReactNode } from "react";

/** A scrollable canvas that gives resizable panels room without resetting their layout. */
export default function Workspace({ name, className = "", minHeight = 960, children }: {
  name: string;
  className?: string;
  minHeight?: number;
  children: ReactNode;
}) {
  return (
    <div className={`workspace scroll-workspace ${className}`} role="region" aria-label={name} tabIndex={0}>
      <div className="workspace-canvas" style={{ "--workspace-height": `${minHeight}px` } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}
