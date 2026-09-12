import { useEffect, useMemo, useRef, useState } from "react";
import type { TradesRange } from "../api";
import { DAY_TS_SPAN, useSelection } from "../store";

type Props = { trades: TradesRange };

const ROW_H = 22;
const OVERSCAN = 8;

export default function TradeTape({ trades }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(220);
  const days = useSelection((s) => s.days);
  const showsIds = trades.buyer.some(Boolean) || trades.seller.some(Boolean);
  const multiDay = days.length > 1;

  const orderedIdx = useMemo(() => {
    const n = trades.timestamp.length;
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = n - 1 - i;
    return out;
  }, [trades]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewport(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = orderedIdx.length;
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [trades]);
  const firstVisible = Math.min(Math.max(0, total - 1), Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const visibleCount = Math.min(
    total - firstVisible,
    Math.ceil(viewport / ROW_H) + OVERSCAN * 2
  );

  const rows: React.ReactNode[] = [];
  for (let row = 0; row < visibleCount; row++) {
    const i = orderedIdx[firstVisible + row];
    const t = trades.timestamp[i];
    const day = multiDay ? days[Math.floor(t / DAY_TS_SPAN)] : null;
    const rawT = multiDay ? t - Math.floor(t / DAY_TS_SPAN) * DAY_TS_SPAN : t;
    rows.push(
      <div
        key={firstVisible + row}
        className={`tape-row ${multiDay ? "multiday" : ""} ${showsIds ? "with-ids" : ""}`}
        style={{ top: (firstVisible + row) * ROW_H }}
      >
        {multiDay && <span className="num day-cell">{day}</span>}
        <span className="num t-cell">{rawT}</span>
        <span className="num">{trades.price[i].toFixed(2)}</span>
        <span className="num">{trades.quantity[i]}</span>
        {showsIds && <span title={trades.buyer[i] ?? "Unknown buyer"}>{trades.buyer[i] ?? "—"}</span>}
        {showsIds && <span title={trades.seller[i] ?? "Unknown seller"}>{trades.seller[i] ?? "—"}</span>}
      </div>
    );
  }

  return (
    <div className="tape-inner">
      <div ref={scrollerRef} className="tape-scroll" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div
        className={`tape-head ${multiDay ? "multiday" : ""} ${showsIds ? "with-ids" : ""}`}
      >
        {multiDay && <span className="num">day</span>}
        <span className="num" title="Timestamp within the original day; newest trades appear first.">Time</span>
        <span className="num" title="Price at which this trade executed.">Price</span>
        <span className="num" title="Number of units exchanged in this trade.">Quantity</span>
        {showsIds && <span>buyer</span>}
        {showsIds && <span>seller</span>}
      </div>
        <div className="tape-spacer" style={{ height: total * ROW_H }}>
          {rows}
        </div>
      </div>
    </div>
  );
}
