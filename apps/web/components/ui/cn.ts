import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className merge for the designed-control layer. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
