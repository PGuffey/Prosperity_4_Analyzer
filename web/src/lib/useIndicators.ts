import { useMemo } from "react";
import type { PricesRange, TradesRange } from "../api";
import {
  imbalance1,
  deviationSeries,
  INDICATORS,
  microprice,
  returns as returnsSeries,
  rollingMean,
  rollingVol,
  rollingZScore,
  spread,
  vwapOnPriceGrid,
  type IndicatorId,
} from "./indicators";
import { useSelection } from "../store";

export type ComputedIndicators = {
  fixed_deviation: (number | null)[] | null;
  sma_deviation: (number | null)[] | null;
  ema_deviation: (number | null)[] | null;
  microprice_gap: (number | null)[] | null;
  // overlays — aligned to prices.timestamp
  microprice: (number | null)[] | null;
  sma: (number | null)[] | null;
  vwap: (number | null)[] | null;
  // subcharts — aligned to prices.timestamp
  spread: (number | null)[] | null;
  imbalance: (number | null)[] | null;
  returns: (number | null)[] | null;
  zscore: (number | null)[] | null;
  rolling_vol: (number | null)[] | null;
};

export function useComputedIndicators(
  prices: PricesRange,
  trades: TradesRange
): ComputedIndicators {
  const enabled = useSelection((s) => s.enabledIndicators);
  const params = useSelection((s) => s.indicatorParams);

  const win = (id: IndicatorId): number =>
    params[id]?.window ?? INDICATORS[id].params?.window ?? 100;

  // Each indicator is memoized off (enabled, params, prices, trades). When the
  // user toggles an indicator off it drops out of the chart but stays cached.
  return useMemo<ComputedIndicators>(() => {
    const want = (id: IndicatorId) => enabled.includes(id);
    return {
      fixed_deviation: want("fixed_deviation") ? deviationSeries(prices, "fixed_deviation", params.fixed_deviation) : null,
      sma_deviation: want("sma_deviation") ? deviationSeries(prices, "sma_deviation", params.sma_deviation) : null,
      ema_deviation: want("ema_deviation") ? deviationSeries(prices, "ema_deviation", params.ema_deviation) : null,
      microprice_gap: want("microprice_gap") ? deviationSeries(prices, "microprice_gap") : null,
      microprice: want("microprice") ? microprice(prices) : null,
      sma: want("sma") ? rollingMean(prices.mid_price, win("sma")) : null,
      vwap: want("vwap") ? vwapOnPriceGrid(prices, trades) : null,
      spread: want("spread") ? spread(prices) : null,
      imbalance: want("imbalance") ? imbalance1(prices) : null,
      returns: want("returns") ? returnsSeries(prices) : null,
      zscore: want("zscore")
        ? rollingZScore(prices.mid_price, win("zscore"))
        : null,
      rolling_vol: want("rolling_vol")
        ? (() => {
            const r = returnsSeries(prices);
            return rollingVol(r, win("rolling_vol"));
          })()
        : null,
    };
    // recompute when inputs change or user toggles/tunes
  }, [prices, trades, enabled, params]);
}
