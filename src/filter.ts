import type { CtftimeEvent, DigestConfig } from './types';

/**
 * `restrictions` values seen in live data: Open, Casual, Prequalified.
 * CTFtime also emits Academic, High-school, Invited, Individual.
 * These are the ones anyone can enter.
 */
const OPEN_RESTRICTIONS: ReadonlySet<string> = new Set(['open', 'casual', 'individual', '']);

export const isOpenToAnyone = (event: CtftimeEvent): boolean =>
  OPEN_RESTRICTIONS.has((event.restrictions ?? '').trim().toLowerCase());

/**
 * A weight of 0 on CTFtime means *unrated* (new or unscored event), not "easy".
 * Treating it as a low weight would silently hide every brand-new CTF, so
 * unrated events always survive the weight filter. See ADR-0003.
 */
export const isUnrated = (event: CtftimeEvent): boolean => !event.weight || event.weight === 0;

const byStartTime = (a: CtftimeEvent, b: CtftimeEvent): number =>
  Date.parse(a.start) - Date.parse(b.start);

export const filterEvents = (
  events: ReadonlyArray<CtftimeEvent>,
  config: DigestConfig,
): ReadonlyArray<CtftimeEvent> =>
  events
    .filter((event) => !(config.onlineOnly && event.onsite))
    .filter((event) => config.includeRestricted || isOpenToAnyone(event))
    .filter((event) => isUnrated(event) || event.weight >= config.weightMin)
    .slice()
    .sort(byStartTime)
    .slice(0, config.maxEvents);
