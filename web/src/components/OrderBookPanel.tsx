import { useQuery } from "@tanstack/react-query";
import { api, type Orderbook } from "../api";
import { fromSyntheticT, useSelection } from "../store";

const EMPTY_BOOK: Orderbook = {
  timestamp: 0,
  mid_price: null,
  spread: null,
  bids: [],
  asks: [],
};

export default function OrderBookPanel() {
  const { season, round, days, product, cursorT } = useSelection();

  let decodedDay: number | null = null;
  let rawT: number | null = null;
  if (cursorT != null && days.length > 0) {
    const { dayIndex, rawT: r } = fromSyntheticT(cursorT);
    decodedDay = days[dayIndex] ?? null;
    rawT = r;
  }

  const ready =
    season != null &&
    round != null &&
    product != null &&
    decodedDay != null &&
    rawT != null;

  const q = useQuery({
    queryKey: ["orderbook", season, round, decodedDay, product, rawT],
    queryFn: () =>
      api.orderbook({
        season: season!,
        round: round!,
        day: decodedDay!,
        product: product!,
        t: rawT!,
      }),
    enabled: ready,
    staleTime: 60_000,
  });

  const ob = ready && q.data ? q.data : EMPTY_BOOK;
  const placeholder = !ready
    ? "move the cursor on the chart"
    : q.isLoading
      ? "…"
      : q.error
        ? "no snapshot at t"
        : null;

  return (
    <>
      <div className="meta-line">
        {ready && (
          <span className="meta">day {decodedDay} • t {rawT}</span>
        )}
        {ob.mid_price != null
          ? <>mid {ob.mid_price.toFixed(2)} • spread {ob.spread ?? "—"}</>
          : <span className="empty">{placeholder}</span>}
      </div>
      <table className="ladder">
        <thead>
          <tr>
            <th>Bid Sz</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>Ask Sz</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2].map((i) => {
            const b = ob.bids[i];
            const a = ob.asks[i];
            return (
              <tr key={i}>
                <td className="num">{b?.[1] ?? ""}</td>
                <td className="bid">{b?.[0] ?? ""}</td>
                <td className="ask">{a?.[0] ?? ""}</td>
                <td className="num">{a?.[1] ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
