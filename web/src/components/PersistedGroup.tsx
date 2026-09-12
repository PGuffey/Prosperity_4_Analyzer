import { type ReactNode } from "react";
import { Group, useDefaultLayout, type Orientation } from "react-resizable-panels";

type Props = {
  id: string;
  orientation: Orientation;
  children: ReactNode;
};

/**
 * A Group whose layout is auto-saved to localStorage under its id.
 * Drop-in replacement for <Group> when you want persistence.
 */
export default function PersistedGroup({ id, orientation, children }: Props) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  });
  return (
    <Group
      id={id}
      orientation={orientation}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {children}
    </Group>
  );
}
