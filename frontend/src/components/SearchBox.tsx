/** A compact search input with its icon — the palette's and the samples table's filter. */

import { SearchIcon } from "./icons";

import "./SearchBox.css";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchBox({ value, onChange, placeholder = "Search", className }: SearchBoxProps) {
  return (
    <label className={className ? `search-box ${className}` : "search-box"}>
      <SearchIcon size={16} />
      <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </label>
  );
}
