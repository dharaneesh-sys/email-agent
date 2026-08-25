export function mark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && performance.mark) performance.mark(name);
  } catch {
    // ignore — performance may be unavailable in some environments
  }
}

export function measure(name: string, startMark: string, endMark?: string): number | undefined {
  try {
    if (typeof performance !== 'undefined' && performance.measure) {
      if (endMark !== undefined) performance.measure(name, startMark, endMark);
      else performance.measure(name, startMark);
      const entries = performance.getEntriesByName(name);
      const last = entries[entries.length - 1];
      return last?.duration;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function clearMarks(): void {
  try {
    if (typeof performance !== 'undefined') {
      if (performance.clearMarks) performance.clearMarks();
      if (performance.clearMeasures) performance.clearMeasures();
    }
  } catch {
    // ignore
  }
}
