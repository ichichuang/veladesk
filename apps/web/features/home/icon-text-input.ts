"use client";

import { useRef, useState } from "react";
import type { CompositionEvent } from "react";

import { clampIconText } from "./icon-text";

/**
 * Wiring for a custom icon-text field: every committed value is clamped to
 * the ONE grapheme the tile renders (typing or pasting "微信" keeps "微",
 * "👨‍👩‍👧" stays whole).
 *
 * IME-safe: while a composition is open (Chinese pinyin, Japanese kana…)
 * the raw text passes through untouched — clamping "wei" to "W" mid-
 * composition would break the IME — and the clamp runs once the
 * composition ends. No `maxLength`: it counts UTF-16 units and would cut
 * an emoji in half.
 */
export function useIconTextInput(commit: (text: string) => void): {
  readonly composing: boolean;
  readonly onChange: (text: string) => void;
  readonly inputProps: {
    readonly onCompositionStart: () => void;
    readonly onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
  };
} {
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  return {
    composing,
    onChange: (text) => commit(composingRef.current ? text : clampIconText(text)),
    inputProps: {
      onCompositionStart: () => {
        composingRef.current = true;
        setComposing(true);
      },
      onCompositionEnd: (event) => {
        composingRef.current = false;
        setComposing(false);
        commit(clampIconText(event.currentTarget.value));
      },
    },
  };
}
