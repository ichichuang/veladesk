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
  const inputId = useId();

  const effective = value ?? "#888888";
  const hexDraftValid = HEX_PATTERN.test(hexDraft);

  function commitHex(next: string) {
    setHexDraft(next);
    if (HEX_PATTERN.test(next)) {
      onChange(next.toLowerCase());
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
                  "size-5 rounded-[5px] border",
                  value === swatch ? "border-vdu-fg" : "border-vdu-border",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                )}
                style={{ background: swatch }}
                onClick={() => onChange(swatch)}
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
