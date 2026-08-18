import { describe, expect, it } from 'vitest';
import { attempt, attemptAsync, err, flatMap, map, mapError, ok, unwrapOr } from '../src/result';

describe('Result', () => {
  it('carries a value through map and short-circuits on error', () => {
    expect(map(ok(2), (n) => n + 1)).toEqual(ok(3));
    expect(map(err('boom'), (n: number) => n + 1)).toEqual(err('boom'));
  });

  it('transforms errors without touching values', () => {
    expect(mapError(err('boom'), (e) => `${e}!`)).toEqual(err('boom!'));
    expect(mapError(ok(1), (e: string) => `${e}!`)).toEqual(ok(1));
  });

  it('chains fallible steps', () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err('odd'));
    expect(flatMap(ok(4), half)).toEqual(ok(2));
    expect(flatMap(ok(3), half)).toEqual(err('odd'));
    expect(flatMap(err('earlier'), half)).toEqual(err('earlier'));
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err('boom'), 9)).toBe(9);
  });
});

describe('attempt', () => {
  it('converts a throwing call into an error value', () => {
    expect(attempt(() => JSON.parse('{"a":1}') as unknown, String)).toEqual(ok({ a: 1 }));
    expect(attempt(() => JSON.parse('nope'), () => 'bad json')).toEqual(err('bad json'));
  });

  it('converts a rejecting call into an error value', async () => {
    await expect(attemptAsync(async () => 1, String)).resolves.toEqual(ok(1));
    await expect(
      attemptAsync(async () => {
        throw new Error('down');
      }, () => 'network'),
    ).resolves.toEqual(err('network'));
  });
});
