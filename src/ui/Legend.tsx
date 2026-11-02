import { useState } from 'react';
import { useTrainStore, type AirStatus } from '../data/trainStore';
import type { Category } from '../data/types';
import { CATEGORY_LABELS, formatTime } from '../lib/format';
import { Chevron } from './icons';

interface Props {
  hidden: ReadonlySet<Category>;
  onToggle(category: Category): void;
}

/** Passenger traffic first, then freight and the rest. */
const ORDER: Category[] = ['long-distance', 'commuter', 'metro', 'tram', 'air', 'cargo', 'other'];

/** What the aircraft row says beneath it: the source allows 100 requests a day. */
function airNote({ state, remaining, resetsAt }: AirStatus) {
  switch (state) {
    case 'off':
      return 'Lähennä Helsinki-Vantaalle, niin koneet haetaan.';
    case 'loading':
      return 'Haetaan lentokoneita…';
    case 'live':
      return remaining == null ? null : `${remaining} hakua tänään jäljellä`;
    case 'used-up':
      return `Päivän haut on käytetty${resetsAt ? `; jatkuu klo ${formatTime(new Date(resetsAt).toISOString())}` : ''}.`;
    case 'error':
      return 'Lentotietoja ei saatu. Yritetään uudelleen.';
  }
}

export function Legend({ hidden, onToggle }: Props) {
  const { counts, ready, connected, recording, air } = useTrainStore();
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const total = ORDER.reduce((sum, c) => sum + counts[c], 0);

  const status = !ready
    ? 'Haetaan junia…'
    : recording
      ? `${total} · tallenne`
      : !connected
        ? 'Yhdistetään uudelleen…'
        : `${total} liikkeellä`;

  return (
    <section className="legend" aria-label="Liikenne kartalla">
      <button
        type="button"
        className="legend-summary"
        aria-expanded={expanded}
        aria-controls="legend-list"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`live-dot${ready && connected && !recording ? ' is-live' : ''}`} aria-hidden />
        <span className="legend-title">Liikenne</span>
        <span className="legend-status" aria-live="polite">
          {status}
        </span>
        <Chevron up={expanded} />
      </button>
      {expanded && (
        <ul className="legend-list" id="legend-list">
          {ORDER.map((c) => (
            <li key={c}>
              <button
                type="button"
                className="legend-item"
                aria-pressed={!hidden.has(c)}
                title={hidden.has(c) ? 'Näytä kartalla' : 'Piilota kartalta'}
                onClick={() => onToggle(c)}
              >
                <span className={`glyph is-${c}`} aria-hidden />
                <span>{CATEGORY_LABELS[c]}</span>
                <span className="legend-count">{counts[c]}</span>
              </button>
              {c === 'air' && !hidden.has('air') && airNote(air) && (
                <p className="legend-sub" aria-live="polite">
                  {airNote(air)}
                </p>
              )}
            </li>
          ))}
          <li className="legend-note">
            <span className="glyph is-late" aria-hidden />
            Juna tai ratikka yli 5 min myöhässä
          </li>
          {recording && (
            <li className="legend-recording">
              Esikatselu: junat liikkuvat tallenteelta{' '}
              {new Date(recording.start).toLocaleDateString('fi-FI', { timeZone: 'Europe/Helsinki' })} klo{' '}
              {formatTime(new Date(recording.start).toISOString())}–{formatTime(new Date(recording.end).toISOString())},
              joka toistuu alusta.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
