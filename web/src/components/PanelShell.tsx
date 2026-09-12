import { useRef, useState, type ReactNode } from "react";
import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { descriptions } from "../lib/descriptions";

type Props = {
  /** Panel id — used by react-resizable-panels for persistence. */
  id: string;
  /** Title shown in the header. */
  title: ReactNode;
  /** Small text/element shown next to the title. */
  meta?: ReactNode;
  /** Default size in the parent Group (percent). */
  defaultSize?: number;
  /** Minimum size in percent. */
  minSize?: number;
  /** Initial collapsed state when no localStorage entry exists. */
  defaultCollapsed?: boolean;
  children: ReactNode;
};

/**
 * A resizable + collapsible panel with a header. Wraps react-resizable-panels'
 * Panel and adds a header bar with a collapse toggle. Collapse state is
 * persisted to localStorage per id; size is persisted by the parent Group
 * (via defaultLayout if provided).
 */
export default function PanelShell({
  id,
  title,
  meta,
  defaultSize,
  minSize,
  defaultCollapsed = false,
  children,
}: Props) {
  const ref = useRef<PanelImperativeHandle | null>(null);
  const lsKey = `pma-panel-collapsed:${id}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(lsKey) : null;
    return stored != null ? stored === "1" : defaultCollapsed;
  });

  const toggle = () => {
    const handle = ref.current;
    if (!handle) return;
    if (handle.isCollapsed()) {
      handle.expand();
    } else {
      handle.collapse();
    }
  };

  return (
    <Panel
      panelRef={ref}
      id={id}
      collapsible
      collapsedSize={3}
      defaultSize={defaultSize}
      minSize={minSize ?? 6}
      onResize={(s) => {
        // react-resizable-panels fires onResize when size changes; detect
        // crossings of the collapsed threshold and reflect to local state +
        // localStorage so the chevron icon stays in sync.
        const isCollapsed = s.asPercentage <= 3.1;
        if (isCollapsed !== collapsed) {
          setCollapsed(isCollapsed);
          localStorage.setItem(lsKey, isCollapsed ? "1" : "0");
        }
      }}
      className={"panel-shell" + (collapsed ? " collapsed" : "")}
      data-panel-id={id}
    >
      <header className="panel-shell-header" onDoubleClick={toggle}>
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={toggle}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${typeof title === "string" ? title : "panel"}`}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="panel-title" title={descriptions[id]}>{title}</span>
        {meta != null && <span className="panel-meta">{meta}</span>}
      </header>
      <div className="panel-shell-body">{children}</div>
    </Panel>
  );
}
