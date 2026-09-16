"use client";

import { useEffect, useRef, useState } from "react";
import {
  dateRangeButtonLabel,
  istYmd,
  presetRange,
  type DatePreset,
} from "@/lib/trip-range";

type Props = {
  preset: DatePreset | "custom";
  from: string;
  to: string;
  onPreset: (preset: DatePreset) => void;
  onCustom: (from: string, to: string) => void;
};

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "all", label: "All time" },
];

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 opacity-70"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="2" y="3.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

export default function DateRangeFilter({
  preset,
  from,
  to,
  onPreset,
  onCustom,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const today = istYmd();
  const label = dateRangeButtonLabel(preset, from, to);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickPreset = (key: DatePreset) => {
    onPreset(key);
    setOpen(false);
  };

  const setStart = (value: string) => {
    const end = to && to >= value ? to : value;
    onCustom(value, end);
  };

  const setEnd = (value: string) => {
    const start = from && from <= value ? from : value;
    onCustom(start, value);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range, ${label}`}
        onClick={toggle}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--gg-line)] bg-white px-2.5 text-sm font-medium text-[var(--gg-forest)]"
      >
        <CalendarIcon />
        <span className="whitespace-nowrap">{label}</span>
        <span className="text-[10px] text-[var(--gg-muted)]" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose date range"
          className="fixed z-50 w-[17.5rem] rounded-xl border border-[var(--gg-line)] bg-white p-2 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <div role="group" aria-label="Preset date ranges" className="grid gap-0.5">
            {PRESETS.map((p) => {
              const on = preset === p.key;
              const hint = presetRange(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => pickPreset(p.key)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-sm ${
                    on
                      ? "bg-[#eef3ee] font-medium text-[var(--gg-forest)]"
                      : "text-[var(--gg-ink)] hover:bg-[#f6f8f6]"
                  }`}
                >
                  <span className="block">{p.label}</span>
                  {hint ? (
                    <span className="text-[10px] font-normal text-[var(--gg-muted)]">
                      {hint.from === hint.to ? hint.from : `${hint.from} → ${hint.to}`}
                    </span>
                  ) : (
                    <span className="text-[10px] font-normal text-[var(--gg-muted)]">
                      All stored trips
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-[var(--gg-line)] pt-2">
            <p className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--gg-muted)]">
              Custom range
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="grid gap-0.5 text-[11px] text-[var(--gg-muted)]">
                Start
                <input
                  type="date"
                  value={from}
                  max={today}
                  onChange={(e) => setStart(e.target.value)}
                  className="min-h-9 rounded-lg border border-[var(--gg-line)] bg-white px-1.5 text-sm text-[var(--gg-ink)]"
                />
              </label>
              <label className="grid gap-0.5 text-[11px] text-[var(--gg-muted)]">
                End
                <input
                  type="date"
                  value={to}
                  max={today}
                  min={from || undefined}
                  onChange={(e) => setEnd(e.target.value)}
                  className="min-h-9 rounded-lg border border-[var(--gg-line)] bg-white px-1.5 text-sm text-[var(--gg-ink)]"
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
