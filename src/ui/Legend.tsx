import { useState } from 'react';
import { useTrainStore } from '../data/trainStore';
import { CATEGORIES, type Category } from '../data/types';
import { CATEGORY_LABELS, formatTime } from '../lib/format';
import { Chevron } from './icons';

interface Props {
  hidden: ReadonlySet<Category>;
  onToggle(category: Category): void;
}

export function Legend({ hidden, onToggle }: Props) {
  const { counts, ready, connected, recording } = useTrainStore();
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const total = CATEGORIES.reduce((sum, c) => sum + counts[c], 0);

  const status = !ready
    ? 'Haetaan junia…'
    : recording
      ? `${total} · tallenne`
      : !connected
        ? 'Yhdistetään uudelleen…'
        : `${total} liikkeellä`;

  return (
    <section className="legend" aria-label="Junat kartalla">
      <button
        type="button"
        className="legend-summary"
        aria-expanded={expanded}
        aria-controls="legend-list"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`live-dot${ready && connected && !recording ? ' is-live' : ''}`} aria-hidden />
        <span className="legend-title">Junat</span>
        <span className="legend-status" aria-live="polite">
          {status}
        </span>
        <Chevron up={expanded} />
      </button>
      {expanded && (
        <ul className="legend-list" id="legend-list">
          {CATEGORIES.map((c) => (
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
            </li>
          ))}
          <li className="legend-note">
            <span className="glyph is-late" aria-hidden />
            Yli 5 min myöhässä
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
