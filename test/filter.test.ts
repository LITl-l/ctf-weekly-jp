import { describe, expect, it } from 'vitest';
import fixture from './fixtures/ctftime.json';
import { filterEvents, isOpenToAnyone, isUnrated } from '../src/filter';
import { DEFAULT_CONFIG } from '../src/config';
import type { CtftimeEvent } from '../src/types';

const events = fixture as unknown as CtftimeEvent[];

describe('filterEvents', () => {
  it('drops onsite events when onlineOnly is set', () => {
    const result = filterEvents(events, { ...DEFAULT_CONFIG, maxEvents: 100 });
    expect(result.every((event) => !event.onsite)).toBe(true);
    expect(events.some((event) => event.onsite)).toBe(true); // fixture really contains onsite events
  });

  it('keeps onsite events when onlineOnly is off', () => {
    const result = filterEvents(events, { ...DEFAULT_CONFIG, onlineOnly: false, maxEvents: 100 });
    expect(result.some((event) => event.onsite)).toBe(true);
  });

  it('drops restricted events by default and keeps them when asked', () => {
    const restricted = events.filter((event) => !isOpenToAnyone(event));
    expect(restricted.length).toBeGreaterThan(0);

    const strict = filterEvents(events, { ...DEFAULT_CONFIG, onlineOnly: false, maxEvents: 100 });
    expect(strict.every(isOpenToAnyone)).toBe(true);

    const loose = filterEvents(events, {
      ...DEFAULT_CONFIG,
      onlineOnly: false,
      includeRestricted: true,
      maxEvents: 100,
    });
    expect(loose.length).toBeGreaterThan(strict.length);
  });

  it('keeps unrated (weight 0) events even above the highest real weight', () => {
    // Fixture weights top out at 96, so nothing rated can clear this bar.
    const result = filterEvents(events, { ...DEFAULT_CONFIG, weightMin: 100, maxEvents: 100 });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(isUnrated)).toBe(true);
  });

  it('drops rated events below weight_min but keeps those above it', () => {
    const result = filterEvents(events, { ...DEFAULT_CONFIG, weightMin: 90, maxEvents: 100 });
    const rated = result.filter((event) => !isUnrated(event));

    expect(rated.length).toBeGreaterThan(0);
    expect(rated.every((event) => event.weight >= 90)).toBe(true);
    // Events like BrunnerCTF (24.66) are rated but below the bar.
    expect(result.some((event) => event.weight > 0 && event.weight < 90)).toBe(false);
  });

  it('caps at max_events and sorts by start time', () => {
    const result = filterEvents(events, { ...DEFAULT_CONFIG, maxEvents: 3 });
    expect(result).toHaveLength(3);
    const starts = result.map((event) => Date.parse(event.start));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
