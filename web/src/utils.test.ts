import { describe, expect, test } from 'bun:test';
import { parseSearchOperators, removeSearchOperator } from './utils';

describe('search operators', () => {
  test('parses operators and plain text', () => {
    const { operators, plain } = parseSearchOperators('from:alice has:attachment quarterly report');
    expect(operators).toEqual([
      { op: 'from', value: 'alice' },
      { op: 'has', value: 'attachment' },
    ]);
    expect(plain).toBe('quarterly report');
  });

  test('handles quoted values', () => {
    const { operators } = parseSearchOperators('subject:"Q3 planning" is:unread');
    expect(operators).toEqual([
      { op: 'subject', value: 'Q3 planning' },
      { op: 'is', value: 'unread' },
    ]);
  });

  test('empty query yields no operators', () => {
    const { operators, plain } = parseSearchOperators('');
    expect(operators).toEqual([]);
    expect(plain).toBe('');
  });

  test('removes a quoted operator and keeps the rest', () => {
    const next = removeSearchOperator('subject:"Q3 planning" is:unread', { op: 'subject', value: 'Q3 planning' });
    expect(next).toBe('is:unread');
  });

  test('removes a bare operator', () => {
    const next = removeSearchOperator('from:alice hello world', { op: 'from', value: 'alice' });
    expect(next).toBe('hello world');
  });
});
