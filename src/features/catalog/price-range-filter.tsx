import { useEffect, useId, useState } from "react";

const DEFAULT_MIN = 2;
const DEFAULT_MAX = 1230;
const cents = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed * 100))
    : fallback;
};
const readRange = (minimum?: string, maximum?: string) => {
  const min = cents(minimum, DEFAULT_MIN);
  const max = cents(maximum, DEFAULT_MAX);
  return { min: Math.min(min, max), max: Math.max(min, max) };
};
const eth = (value: number) => (value / 100).toFixed(2);
const label = (value: number) => eth(value).replace(".", ",");

export function PriceRangeFilter({
  minimum,
  maximum,
  onApply,
}: {
  minimum?: string;
  maximum?: string;
  onApply: (minimum: string, maximum: string) => void;
}) {
  const id = useId();
  const [range, setRange] = useState(() => readRange(minimum, maximum));
  useEffect(() => setRange(readRange(minimum, maximum)), [minimum, maximum]);
  const limit = Math.max(
    DEFAULT_MAX,
    cents(minimum, DEFAULT_MIN),
    cents(maximum, DEFAULT_MAX),
  );
  const start = (range.min / limit) * 100;
  const end = (range.max / limit) * 100;
  const midpoint = (start + end) / 2;
  return (
    <form
      className="price-filter"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(eth(range.min), eth(range.max));
      }}
    >
      <h3>Faixa de preço</h3>
      <div className="price-range">
        <span className="price-range-track" aria-hidden="true" />
        <span
          className="price-range-selection"
          aria-hidden="true"
          style={{ left: `${start}%`, right: `${100 - end}%` }}
        />
        <input
          id={`${id}-min`}
          type="range"
          aria-label="Preço mínimo"
          aria-valuetext={`${label(range.min)} ETH`}
          min="0"
          max={limit}
          step="1"
          value={range.min}
          style={{ clipPath: `inset(-6px ${100 - midpoint}% -6px -6px)` }}
          onChange={(event) =>
            setRange((current) => ({
              ...current,
              min: Math.min(Number(event.target.value), current.max),
            }))
          }
        />
        <input
          id={`${id}-max`}
          type="range"
          aria-label="Preço máximo"
          aria-valuetext={`${label(range.max)} ETH`}
          min="0"
          max={limit}
          step="1"
          value={range.max}
          style={{ clipPath: `inset(-6px -6px -6px ${midpoint}%)` }}
          onChange={(event) =>
            setRange((current) => ({
              ...current,
              max: Math.max(Number(event.target.value), current.min),
            }))
          }
        />
      </div>
      <output className="price-range-label" htmlFor={`${id}-min ${id}-max`}>
        Preço: {label(range.min)} – {label(range.max)} ETH
      </output>
      <button className="filter-apply" type="submit">
        Aplicar
      </button>
    </form>
  );
}
