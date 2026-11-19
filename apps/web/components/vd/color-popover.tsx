"use client";

import { useId, useState } from "react";
import { HexColorPicker } from "react-colorful";

import { cn } from "@components/ui/cn";
import { Input } from "@components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";

/**
 * ColorField (task 018, refined 019-D): the designed replacement for the
 * browser color well. ONE row trigger — a swatch plus the current value
 * ("Auto" or the hex) — opens the shared Popover hosting react-colorful,
 * with a validated HEX input, preset swatches and an explicit Auto reset.
 * The `autoValue` contract preserves the existing "Auto" default semantics
 * — choosing Auto stores `undefined`; the persisted custom color is never
 * dropped silently.
 */

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalizes a committed hex to the persisted `#rrggbb` form, expanding
 * 3-digit shorthand (`#abc` → `#aabbcc`); undefined when unparsable —
 * partial typing never fires onChange. Pure.
 */
function normalizeCommittedHex(next: string): string | undefined {
  const trimmed = next.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  let digits = trimmed.slice(1);
  if (digits.length === 3) {
    digits = [...digits].map((c) => c + c).join("");
  }
  return `#${digits.toLowerCase()}`;
}

/** Preset swatches — the palette the app visual editor has always offered. */
const PRESET_SWATCHES: readonly string[] = [
  "#5b8def",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#64748b",
];

export function ColorField({
  label,
  value,
  onChange,
  autoLabel,
  swatchAriaLabel,
  className,
}: {
  readonly label: string;
  /** `undefined` = Auto (the stored default). */
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
  readonly autoLabel: string;
  readonly swatchAriaLabel: string;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string>(value ?? "");
  // task 028: the hex draft FOLLOWS the external value — picking a preset
  // swatch used to leave the input showing the stale text. Derived DURING
  // RENDER (the react-hooks rule: no setState inside effects).
  const [lastExternal, setLastExternal] = useState<string>(value ?? "");
  if ((value ?? "") !== lastExternal) {
    setLastExternal(value ?? "");
    setHexDraft(value ?? "");
  }
  const inputId = useId();

  const effective = value ?? "#888888";
  const hexDraftValid = HEX_PATTERN.test(hexDraft);

  function commitHex(next: string) {
    setHexDraft(next);
    const normalized = normalizeCommittedHex(next);
    if (normalized !== undefined) {
      // task 028: 3-digit shorthand expands to the 6-digit form BEFORE the
      // domain gate — `#abc` used to pass this input, reach the draft, and
      // be silently dropped by the persisted-format gate (normalize never
      // saw a valid 6-digit color), so a pick could end in "no change".
      onChange(normalized);
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} — ${swatchAriaLabel}`}
            className={cn(
              "flex h-10 min-w-[9rem] items-center gap-2.5 rounded-vdu px-3 outline-none",
              
              "hover:bg-vdu-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
            )}
          >
            <span
              aria-hidden="true"
              className="size-6 shrink-0 rounded-[6px] border border-vdu-border-strong"
              style={{ background: effective }}
            />
            <span className="truncate font-mono text-xs uppercase text-vdu-fg">
              {value === undefined ? autoLabel : value.toLowerCase()}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[232px] p-3">
          <div className="vdu-colorful">
            <HexColorPicker color={effective} onChange={commitHex} />
          </div>
          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {PRESET_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                className={cn(
                  "size-5 rounded-[5px] border transition-colors duration-[var(--vd-motion-fast)] ease-[var(--vd-motion-ease)]",
                  value === swatch ? "border-vdu-fg" : "border-vdu-border",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                )}
                style={{ background: swatch }}
                onClick={() => {
                  // task 028: keep the input in step with the pick.
                  setHexDraft(swatch);
                  onChange(swatch);
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor={inputId} className="text-xs font-medium text-vdu-fg-muted">
              HEX
            </label>
            <Input
              id={inputId}
              className="h-8 font-mono text-xs uppercase"
              placeholder="#8b5cf6"
              value={hexDraft}
              aria-invalid={!hexDraftValid && hexDraft.length > 0}
              onChange={(event) => commitHex(event.target.value)}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className={cn(
                "rounded-vdu px-2.5 py-1 text-xs font-medium text-vdu-fg-muted outline-none",
                
                "hover:bg-vdu-bg-hover hover:text-vdu-fg disabled:pointer-events-none disabled:opacity-50",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
              )}
              disabled={value === undefined}
              onClick={() => {
                setHexDraft("");
                onChange(undefined);
              }}
            >
              {autoLabel}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
