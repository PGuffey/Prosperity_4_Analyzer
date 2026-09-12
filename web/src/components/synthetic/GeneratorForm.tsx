import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type GenerateBody, type GeneratorMeta, type GeneratorParamSpec } from "../../api";
import { useSelection } from "../../store";

type Props = {
  onGenerate: (body: GenerateBody) => void;
  busy?: boolean;
};

function defaultParams(meta: GeneratorMeta): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(meta.params)) {
    out[k] = spec.default;
  }
  return out;
}

export default function GeneratorForm({ onGenerate, busy }: Props) {
  const { season, round, days, product } = useSelection();

  const gens = useQuery({ queryKey: ["synthetic-generators"], queryFn: api.syntheticGenerators });
  const meta = gens.data;

  const [selected, setSelected] = useState<string>("");
  const [params, setParams] = useState<Record<string, number | string | boolean>>({});
  const [seed, setSeed] = useState<number>(42);
  const [name, setName] = useState<string>("");

  // When generator metadata first arrives, pick a sensible default.
  useEffect(() => {
    if (!meta) return;
    if (!selected) {
      const first = Object.keys(meta)[0];
      if (first) {
        setSelected(first);
        setParams(defaultParams(meta[first]));
      }
    }
  }, [meta, selected]);

  // When the user switches generator, reset its params to defaults.
  useEffect(() => {
    if (!meta || !selected) return;
    if (meta[selected]) {
      setParams(defaultParams(meta[selected]));
    }
  }, [selected, meta]);

  const selectedMeta = meta && selected ? meta[selected] : null;

  const ready =
    season != null &&
    round != null &&
    days.length > 0 &&
    product != null &&
    selected !== "";

  const build = (): GenerateBody | null => {
    if (!ready) return null;
    return {
      season: season!,
      round: round!,
      days,
      product: product!,
      generator: selected,
      params,
      seed,
      name: name.trim() || undefined,
    };
  };

  const renderParamInput = (key: string, spec: GeneratorParamSpec) => {
    const v = params[key];
    const onChange = (newV: number | string | boolean) => {
      setParams((p) => ({ ...p, [key]: newV }));
    };
    if (spec.type === "int" || spec.type === "float") {
      return (
        <input
          type="number"
          step={spec.type === "int" ? 1 : "any"}
          min={spec.min}
          max={spec.max}
          value={typeof v === "number" ? v : Number(v) || 0}
          onChange={(e) => onChange(spec.type === "int" ? Math.round(Number(e.target.value) || 0) : Number(e.target.value) || 0)}
        />
      );
    }
    if (spec.type === "bool") {
      return (
        <input
          type="checkbox"
          checked={Boolean(v)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    }
    // enum
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
        {spec.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  };

  const sortedKeys = useMemo(() => Object.keys(selectedMeta?.params ?? {}), [selectedMeta]);

  return (
    <div className="synthetic-generator">
      <div className="form-row">
        <label>
          Source
          <span className="src-pill">
            {season ?? "—"} / R{round ?? "—"} / d{days.join(",") || "—"} / {product ?? "—"}
          </span>
        </label>
      </div>

      <div className="form-row">
        <label className="grow">
          Generator
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!meta}>
            {meta &&
              Object.entries(meta).map(([id, m]) => (
                <option key={id} value={id}>{m.label}</option>
              ))}
          </select>
        </label>
        <label>
          Seed
          <input
            type="number"
            value={seed}
            step={1}
            onChange={(e) => setSeed(Math.round(Number(e.target.value) || 0))}
          />
        </label>
      </div>

      {selectedMeta && (
        <p className="gen-desc">{selectedMeta.description}</p>
      )}

      {selectedMeta && sortedKeys.length > 0 && (
        <div className="form-grid params-grid">
          {sortedKeys.map((k) => (
            <label key={k}>
              {k}
              {renderParamInput(k, selectedMeta.params[k])}
            </label>
          ))}
        </div>
      )}

      <div className="actions">
        <button
          className="btn primary"
          disabled={!ready || busy}
          onClick={() => {
            const b = build();
            if (b) onGenerate(b);
          }}
        >
          {busy ? "Generating…" : "Generate & save"}
        </button>
        <input
          type="text"
          className="save-name"
          placeholder="optional name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </div>
  );
}
