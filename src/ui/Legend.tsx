import { useState } from 'react';
import { useTrainStore } from '../data/trainStore';
import { TRAIN_CATEGORIES, type Category } from '../data/types';
import { CATEGORY_LABELS, formatTime } from '../lib/format';
import { Chevron } from './icons';

interface Props {
  hidden: ReadonlySet<Category>;
  onToggle(category: Category): void;
  onToggleTrains(): void;
}

export function Legend({ hidden, onToggle, onToggleTrains }: Props) {
  const { counts, ready, connected, recording } = useTrainStore();
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const trains = TRAIN_CATEGORIES.reduce((sum, c) => sum + counts[c], 0);
  const trainsShown = TRAIN_CATEGORIES.some((c) => !hidden.has(c));
  const metroShown = !hidden.has('metro');
  const live = ready && connected && !recording;

  const status = !ready
    ? 'Haetaan junia…'
    : recording
      ? 'Tallenne'
      : !connected
        ? 'Yhdistetään uudelleen…'
        : null;

  return (
    <section className="legend" aria-label="Kartalla näkyvät">
      <div className="legend-bar">
        <span className={`live-dot${live ? ' is-live' : ''}`} title={live ? 'Reaaliaikainen' : undefined} aria-hidden />
        <div className="modes" role="group" aria-label="Näytä kartalla">
          <button type="button" className="mode" aria-pressed={trainsShown} onClick={onToggleTrains}>
            <span className="glyph is-long-distance" aria-hidden />
            Junat
            <span className="mode-count">{ready ? trains : '–'}</span>
          </button>
          <button type="button" className="mode" aria-pressed={metroShown} onClick={() => onToggle('metro')}>
            <span className="glyph is-metro" aria-hidden />
            Metro
            <span className="mode-count">{counts.metro || '–'}</span>
          </button>
        </div>
        <button
          type="button"
          className="legend-expand"
          aria-expanded={expanded}
          aria-controls="legend-list"
          aria-label={expanded ? 'Piilota selite' : 'Näytä selite'}
          onClick={() => setExpanded(!expanded)}
        >
          <Chevron up={expanded} />
        </button>
      </div>
      {status && (
        <p className="legend-status" aria-live="polite">
          {status}
        </p>
      )}
      {expanded && (
        <ul className="legend-list" id="legend-list">
          {TRAIN_CATEGORIES.map((c) => (
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
            Matkustajajuna yli 5 min myöhässä
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
