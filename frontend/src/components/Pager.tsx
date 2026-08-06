/**
 * "Showing 1–200 of 342" plus prev/next.
 *
 * Offset paging, matching the API (`limit`/`offset` + `X-Total-Count`).
 * Renders nothing when everything fits on one page — the common case for a
 * lab-sized registry, where a pager would just be noise.
 */

import { Button } from "./Button";

import "./Pager.css";

interface PagerProps {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  /** Plural noun for the summary line, e.g. "samples". */
  noun: string;
}

export function Pager({ total, limit, offset, onOffsetChange, noun }: PagerProps) {
  if (total <= limit) return null;

  const first = offset + 1;
  const last = Math.min(offset + limit, total);

  return (
    <div className="pager">
      <span className="label">
        Showing {first}–{last} of {total} {noun}
      </span>
      <Button disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <Button disabled={last >= total} onClick={() => onOffsetChange(offset + limit)}>
        Next
      </Button>
    </div>
  );
}
