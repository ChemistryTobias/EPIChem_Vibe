/**
 * Material Symbols, inlined as components.
 *
 * Inline rather than files under `public/`: these sit inside buttons that
 * change colour with state, and `fill="currentColor"` lets them follow the
 * button's text colour. A static file served from `public/` would need an
 * `<img>`, which CSS can't recolour, and would miss Vite's asset hashing.
 */

interface IconProps {
  /** Rendered at the current font size by default. */
  size?: number;
  className?: string;
}

/** Material Symbols `account_tree`, turned upright and mirrored so it reads
 * top-down with its branches falling the same way the tree's rows indent. */
export function TreeIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={{ transform: "rotate(90deg) scaleY(-1)" }}
    >
      <path d="M600-120v-120H440v-400h-80v120H80v-320h280v120h240v-120h280v320H600v-120h-80v320h80v-120h280v320H600ZM160-760v160-160Zm520 400v160-160Zm0-400v160-160Zm0 160h120v-160H680v160Zm0 400h120v-160H680v160ZM160-600h120v-160H160v160Z" />
    </svg>
  );
}

/** Material Symbols `search`. */
export function SearchIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
    </svg>
  );
}

/** Material Symbols "edit" — switches the inspector into its editor. */
export function PencilIcon() {
  return (
    <svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
    </svg>
  );
}

/** Material Symbols "visibility" — switches back to reading. */
export function EyeIcon() {
  return (
    <svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Z" />
    </svg>
  );
}
