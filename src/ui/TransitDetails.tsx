import { stationName, trainStore } from '../data/trainStore';
import { lineOf, networkOf, nextStationIndex, terminiOf } from '../data/transit';
import type { TrainKey } from '../data/types';
import { ago, clockTime, delayShort, isLate } from '../lib/format';
import { useNow } from '../lib/hooks';

const SOURCES = { helsinki: 'HSL', tampere: 'Tampereen joukkoliikenne Nysse' };

/**
 * Metros and trams: the feeds give no live timetable to show, so this lists
 * the stops of the line and shows where along it the vehicle is.
 */
export function TransitDetails({ trainKey }: { trainKey: TrainKey }) {
  const now = useNow(1000);
  const meta = trainStore.getMeta(trainKey);
  const location = trainStore.getLocation(trainKey);
  const position = trainStore.getDrawnPosition(trainKey);
  const run = meta?.transit;
  const network = run && trainStore.networks.get(networkOf(run));
  const line = network && run ? lineOf(network, run) : undefined;
  const termini = network && run ? terminiOf(network, run) : null;

  // Short turns run only part of the line.
  const from = line && termini ? line.stations.indexOf(termini.first) : 0;
  const to = line && termini ? line.stations.indexOf(termini.last) : -1;
  const next = line && position ? nextStationIndex(line, position) : -1;
  const stops = line ? line.stations.slice(from, to + 1).map((id, i) => ({ id, index: from + i })) : [];
  const nextStop = line && next >= from && next <= to ? line.stations[next] : null;
  const isTram = run?.mode === 'tram';

  return (
    <div className="details">
      <dl className="stats">
        <div>
          <dt>Nopeus</dt>
          <dd>{location ? <>{location.speed}<small> km/h</small></> : '–'}</dd>
        </div>
        {isTram ? (
          <div>
            <dt>Aikataulu</dt>
            <dd className={isLate(meta?.delay) ? 'is-late' : undefined}>{delayShort(meta?.delay) ?? '–'}</dd>
          </div>
        ) : (
          <div>
            <dt>Lähti</dt>
            <dd>{run ? clockTime(run.start) : '–'}</dd>
          </div>
        )}
        <div>
          <dt>Seuraavaksi</dt>
          <dd>{nextStop ? stationName(nextStop) : line && position ? 'Perillä' : '–'}</dd>
        </div>
      </dl>

      {!line && <p className="details-note">Haetaan linjan pysäkkejä…</p>}

      {line && (
        <section aria-label={isTram ? 'Pysäkit' : 'Asemat'}>
          <ol className="timetable is-untimed">
            {stops.map(({ id, index }) => {
              const state = index < next ? 'passed' : index === next ? 'next' : 'ahead';
              return (
                <li key={`${id}-${index}`} className={`stop is-${state}`} aria-current={state === 'next' ? 'step' : undefined}>
                  <span className="stop-node" aria-hidden />
                  <span className="stop-name">{stationName(id)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="details-source">
        {location && <>Sijainti päivitetty {ago(location.timestamp, now)}. </>}
        Lähde: {run ? SOURCES[run.city] : 'HSL'}, CC BY 4.0
      </p>
    </div>
  );
}
