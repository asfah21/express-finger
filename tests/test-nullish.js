// Minimal reproduction: does ?? work in vitest?
import { describe, it, expect } from 'vitest';

function makeRow(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'default',
    device: overrides.device ?? 'Device-A',
  };
}

describe('nullish coalescing', () => {
  it('should return null when null is passed', () => {
    const row = makeRow({ device: null });
    expect(row.device).toBeNull();
  });

  it('should return undefined when undefined is passed', () => {
    const row = makeRow({ device: undefined });
    expect(row.device).toBeUndefined();
  });

  it('should return default when nothing is passed', () => {
    const row = makeRow({});
    expect(row.device).toBe('Device-A');
  });
});
