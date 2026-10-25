import { stationName, trainStore } from '../data/trainStore';
import type { TrainKey } from '../data/types';
import { delayText, isLate, trainTitle, typeName } from '../lib/format';
import { useNow } from '../lib/hooks';
import { ArrowRight } from './icons';

interface Props {
  trainKey: TrainKey;
  /** A pinned card belongs to the selected train and can open its details. */
  pinned: boolean;
  onOpen(): void;
}

export function TrainCard({ trainKey, pinned, onOpen }: Props) {
  useNow(1000);
  const meta = trainStore.getMeta(trainKey);
  const location = trainStore.getLocation(trainKey);
  const number = Number(trainKey.split('/')[1]);

  const title = meta ? trainTitle(meta) : `Juna ${number}`;
  const kind = meta ? (meta.commuterLine ? `Lähijuna ${meta.trainNumber}` : typeName(meta.type)) : null;
  const delay = delayText(meta?.delay);

  return (
    <div className={`card${pinned ? ' is-pinned' : ''}`}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        {location && <span className="card-speed">{location.speed} km/h</span>}
      </div>
      {kind && <div className="card-kind">{kind}</div>}
      {meta?.origin && meta.destination && (
        <div className="card-route">
          {stationName(meta.origin.code)} <span aria-hidden>→</span>
          <span className="sr-only">–</span> {stationName(meta.destination.code)}
        </div>
      )}
      {delay && <div className={`card-delay${isLate(meta?.delay) ? ' is-late' : ''}`}>{delay}</div>}
      {pinned && (
        <button type="button" className="card-open" onClick={onOpen}>
          Aikataulu ja tiedot
          <ArrowRight />
        </button>
      )}
    </div>
  );
}
