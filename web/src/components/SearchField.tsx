import type { RefObject } from 'react';
import { parseSearchOperators, removeSearchOperator } from '../utils';
import { SearchIcon, XIcon } from '../icons';
import { IconButton } from './Button';

interface SearchFieldProps {
  value: string;
  onChange(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SearchField({ value, onChange, inputRef }: SearchFieldProps) {
  const { operators } = parseSearchOperators(value);

  return (
    <div className="search-wrap">
      <div className="search-field">
        <SearchIcon size={16} className="search-icon" />
        <input
          ref={inputRef}
          type="search"
          className="search-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search emails… from:x has:attachment"
          aria-label="Search emails"
          spellCheck={false}
          autoComplete="off"
        />
        {value.length > 0 ? (
          <IconButton
            size="sm"
            label="Clear search"
            className="search-clear"
            style={{ position: 'absolute', insetInlineEnd: '4px' }}
            onClick={() => onChange('')}
          >
            <XIcon size={14} />
          </IconButton>
        ) : (
          <kbd className="search-kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      {operators.length > 0 && (
        <div className="search-chips" role="list" aria-label="Active search operators">
          {operators.map((op) => (
            <span key={`${op.op}:${op.value}`} className="search-chip" role="listitem">
              <span className="search-chip-op">{op.op}</span>
              {op.value && <span className="search-chip-value">{op.value}</span>}
              <button
                type="button"
                className="search-chip-remove"
                aria-label={`Remove ${op.op} operator`}
                onClick={() => onChange(removeSearchOperator(value, op))}
              >
                <XIcon size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
