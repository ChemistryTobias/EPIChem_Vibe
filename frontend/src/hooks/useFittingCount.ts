/**
 * How many of a row's items fit in the space it has.
 *
 * Used to keep a toolbar on one line: the caller renders only the first
 * `count` items, so the rest disappear entirely rather than wrapping or being
 * clipped mid-item.
 *
 * Item widths are measured once, on the first layout while everything is
 * still rendered, and cached — after that a hidden item can't be measured, so
 * re-measuring would ratchet the row down and never let it grow back.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Must match the row's CSS `gap` (--space-2). */
const GAP_PX = 8;

export function useFittingCount(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
): number {
  const widths = useRef<number[]>([]);
  const [count, setCount] = useState(itemCount);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (widths.current.length !== itemCount) {
      widths.current = Array.from(el.children).map((child) => (child as HTMLElement).offsetWidth);
    }

    const fit = () => {
      const available = el.clientWidth;
      let used = 0;
      let fits = 0;
      for (const width of widths.current) {
        const next = used + width + (fits > 0 ? GAP_PX : 0);
        if (next > available) break;
        used = next;
        fits += 1;
      }
      setCount(fits);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, itemCount]);

  return count;
}
