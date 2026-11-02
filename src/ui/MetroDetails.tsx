import { stationName, trainStore } from '../data/trainStore';
import { lineOf, nextStationIndex, terminiOf } from '../data/metro';
import type { TrainKey } from '../data/types';
import { ago, metroStart } from '../lib/format';
import { useNow } from '../lib/hooks';

/** The metro has no live timetable in the feed, so this shows where along its line the train is. */
export function MetroDetails({ trainKey }: { trainKey: TrainKey }) {
  const now = useNow(1000);
  const meta = trainStore.getMeta(trainKey);
  const location = trainStore.getLocation(trainKey);
  const position = trainStore.getDrawnPosition(trainKey);
  const network = trainStore.metro;
  const run = meta?.metro;
  const line = network && run ? lineOf(network, run.line, run.direction) : undefined;
  const termini = network && run ? terminiOf(network, run.line, run.direction) : null;

  // Short turns run only part of the line.
  const from = line && termini ? line.stations.indexOf(termini.first) : 0;
  const to = line && termini ? line.stations.indexOf(termini.last) : -1;
  const next = line && position ? nextStationIndex(line, position) : -1;
  const stations = line ? line.stations.slice(from, to + 1).map((id, i) => ({ id, index: from + i })) : [];
  const nextStation = line && next >= from && next <= to ? line.stations[next] : null;

  return (
    <div className="details">
      <dl className="stats">
        <div>
          <dt>Nopeus</dt>
          <dd>{location ? <>{location.speed}<small> km/h</small></> : '–'}</dd>
        </div>
        <div>
          <dt>Lähti</dt>
          <dd>{run ? metroStart(run.start) : '–'}</dd>
        </div>
        <div>
          <dt>Seuraavaksi</dt>
          <dd>{nextStation ? stationName(nextStation) : line && position ? 'Perillä' : '–'}</dd>
        </div>
      </dl>

      {!line && <p className="details-note">Haetaan metrolinjaa…</p>}

      {line && (
        <section aria-label="Asemat">
          <ol className="timetable is-untimed">
            {stations.map(({ id, index }) => {
              const state = index < next ? 'passed' : index === next ? 'next' : 'ahead';
              return (
                <li key={id} className={`stop is-${state}`} aria-current={state === 'next' ? 'step' : undefined}>
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
        Lähde: HSL, CC BY 4.0
      </p>
    </div>
  );
}
