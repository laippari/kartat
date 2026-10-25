import { useMemo, useState } from 'react';
import { stationName, trainStore } from '../data/trainStore';
import { useTrainDetails } from '../data/useTrainDetails';
import type { TrainKey } from '../data/types';
import { ago, delayShort, formatTime, isLate, operatorName, trainTitle, typeName } from '../lib/format';
import { useNow } from '../lib/hooks';
import { currentDelay, effectiveTime, mainRow, nextStop as findNextStop, toStops, visibleStops, type Stop } from '../lib/timetable';
import { Close, Follow } from './icons';

interface HeaderProps {
  trainKey: TrainKey;
  following: boolean;
  onFollow(): void;
  onClose(): void;
}

export function TrainHeader({ trainKey, following, onFollow, onClose }: HeaderProps) {
  const meta = trainStore.getMeta(trainKey);
  const number = Number(trainKey.split('/')[1]);
  const kind = meta && [meta.commuterLine ? `Lähijuna ${meta.trainNumber}` : typeName(meta.type), operatorName(meta.operator)];

  return (
    <div className="train-header">
      <div className="train-header-text">
        <h2 className="train-title">{meta ? trainTitle(meta) : `Juna ${number}`}</h2>
        {kind && <p className="train-kind">{kind.join(' · ')}</p>}
        {meta?.origin && meta.destination && (
          <p className="train-route">
            {stationName(meta.origin.code)}
            <span className="train-route-dash" aria-hidden />
            <span className="sr-only">–</span>
            {stationName(meta.destination.code)}
          </p>
        )}
      </div>
      <div className="train-header-actions">
        <button
          type="button"
          className={`icon-button${following ? ' is-active' : ''}`}
          aria-pressed={following}
          aria-label="Seuraa junaa kartalla"
          title="Seuraa junaa"
          onClick={onFollow}
        >
          <Follow />
        </button>
        <button type="button" className="icon-button" aria-label="Sulje" title="Sulje" onClick={onClose}>
          <Close />
        </button>
      </div>
    </div>
  );
}

export function TrainDetails({ trainKey }: { trainKey: TrainKey }) {
  const { train, loading, error } = useTrainDetails(trainKey);
  const [showAll, setShowAll] = useState(false);
  const now = useNow(1000);
  const location = trainStore.getLocation(trainKey);

  const stops = useMemo(() => (train ? toStops(train.timeTableRows) : []), [train]);
  const shown = useMemo(() => (train ? visibleStops(train, stops, showAll) : []), [train, stops, showAll]);
  // The next stop among those listed: for passenger trains, where people can get on.
  const nextStop = findNextStop(shown);
  const delay = train ? currentDelay(train.timeTableRows) : trainStore.getMeta(trainKey)?.delay;
  const hiddenCount = stops.length - shown.length;

  return (
    <div className="details">
      <dl className="stats">
        <div>
          <dt>Nopeus</dt>
          <dd>{location ? <>{location.speed}<small> km/h</small></> : '–'}</dd>
        </div>
        <div>
          <dt>Aikataulu</dt>
          <dd className={isLate(delay) ? 'is-late' : undefined}>{delayShort(delay) ?? '–'}</dd>
        </div>
        <div>
          <dt>Seuraavaksi</dt>
          <dd>{nextStop ? stationName(nextStop.code) : train ? 'Perillä' : '–'}</dd>
        </div>
      </dl>

      {loading && <p className="details-note">Haetaan aikataulua…</p>}
      {error && !train && <p className="details-note">Aikataulua ei saatu haettua. Yritetään uudelleen hetken kuluttua.</p>}

      {train && (
        <section aria-label="Aikataulu">
          <ol className="timetable">
            {shown.map((stop) => (
              <StopRow key={`${stop.code}-${mainRow(stop).scheduledTime}`} stop={stop} isNext={stop === nextStop} />
            ))}
          </ol>
          {(hiddenCount > 0 || showAll) && (
            <button type="button" className="text-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Näytä vain pysähdykset' : `Näytä myös ohitettavat liikennepaikat (${hiddenCount})`}
            </button>
          )}
        </section>
      )}

      <p className="details-source">
        {location && <>Sijainti päivitetty {ago(location.timestamp, now)}. </>}
        Lähde: Fintraffic / digitraffic.fi, CC BY 4.0
      </p>
    </div>
  );
}

function StopRow({ stop, isNext }: { stop: Stop; isNext: boolean }) {
  const row = mainRow(stop);
  const scheduled = formatTime(row.scheduledTime);
  const best = formatTime(effectiveTime(row));
  const changed = best !== scheduled;
  const late = isLate(row.differenceInMinutes);
  const state = stop.passed ? 'passed' : isNext ? 'next' : 'ahead';

  return (
    <li className={`stop is-${state}${stop.stopping ? '' : ' is-passing'}`} aria-current={isNext ? 'step' : undefined}>
      <span className="stop-time">
        {stop.cancelled ? (
          <>
            <s>{scheduled}</s>
          </>
        ) : changed ? (
          <>
            <span className={late ? 'is-late' : undefined}>{best}</span>
            <s className="stop-scheduled">{scheduled}</s>
          </>
        ) : (
          scheduled
        )}
      </span>
      <span className="stop-node" aria-hidden />
      <span className="stop-name">
        {stationName(stop.code)}
        {stop.cancelled && <span className="stop-flag is-late">Peruttu</span>}
        {!stop.stopping && <span className="stop-flag">ohitus</span>}
      </span>
      <span className="stop-track">{stop.track && stop.commercial ? `raide ${stop.track}` : ''}</span>
    </li>
  );
}
