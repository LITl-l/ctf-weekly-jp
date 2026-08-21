import type { CtftimeEvent } from '../../src/types';

/**
 * Complete, valid event. Tests override only the fields under test, so adding a
 * field to CtftimeEvent does not require touching every test.
 */
const BASE: CtftimeEvent = {
  id: 1,
  ctf_id: 1,
  ctftime_url: 'https://ctftime.org/event/1/',
  title: 'Test CTF',
  description: 'A test CTF',
  url: 'https://example.test/',
  logo: '',
  start: '2026-08-21T12:00:00+00:00',
  finish: '2026-08-23T12:00:00+00:00',
  duration: { days: 2, hours: 0 },
  weight: 0,
  participants: 10,
  format: 'Jeopardy',
  format_id: 1,
  onsite: false,
  location: '',
  restrictions: 'Open',
  organizers: [{ id: 1, name: 'Testers' }],
  prizes: '',
  live_feed: '',
  is_votable_now: false,
  public_votable: false,
};

export const makeEvent = (overrides: Partial<CtftimeEvent> = {}): CtftimeEvent => ({
  ...BASE,
  ...overrides,
});
