import type { RefObject } from 'react';
import { SearchIcon } from '../icons';

interface SearchFieldProps {
  value: string;
  onChange(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SearchField({ value, onChange, inputRef }: SearchFieldProps) {
  return (
    <div className="search-field">
      <SearchIcon size={16} className="search-icon" />
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search emails…"
        aria-label="Search emails"
        spellCheck={false}
        autoComplete="off"
      />
      <kbd className="search-kbd" aria-hidden="true">
        /
      </kbd>
    </div>
  );
}
