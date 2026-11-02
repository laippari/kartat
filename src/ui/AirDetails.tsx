import { AIR_PROVIDER, flightPhase, kmFromAirport } from '../data/air';
import { trainStore, useTrainStore } from '../data/trainStore';
import type { TrainKey } from '../data/types';
import { ago, altitudeText, climbText, PHASE_TEXT } from '../lib/format';
import { useNow } from '../lib/hooks';

/** An aircraft: what its transponder says. ADS-B carries no route or schedule. */
export function AirDetails({ trainKey }: { trainKey: TrainKey }) {
  const now = useNow(1000);
  const { air: status } = useTrainStore();
  const meta = trainStore.getMeta(trainKey);
  const location = trainStore.getLocation(trainKey);
  const air = meta?.air;
  const at: [number, number] | null = location ? [location.lng, location.lat] : null;

  const rows: [string, string | null][] = air
    ? [
        ['Tilanne', at && location ? PHASE_TEXT[flightPhase(air, at, location.speed)] : null],
        ['Etäisyys Helsinki-Vantaalta', at ? `${Math.round(kmFromAirport(at))} km` : null],
        ['Lento', air.callsign],
        ['Rekisteri', air.registration],
        ['Konetyyppi', air.model ?? air.type],
        ['Operaattori', air.operator],
        ['Transponderikoodi', air.squawk],
      ]
    : [];

  return (
    <div className="details">
      <dl className="stats">
        <div>
          <dt>Korkeus</dt>
          <dd>{air ? altitudeText(air.altitude) : '–'}</dd>
        </div>
        <div>
          <dt>Nopeus</dt>
          <dd>{location ? <>{location.speed}<small> km/h</small></> : '–'}</dd>
        </div>
        <div>
          <dt>Nousu</dt>
          <dd>{air ? climbText(air.climb) : '–'}</dd>
        </div>
      </dl>

      {!air && <p className="details-note">Kone ei ole enää näkyvissä.</p>}

      {air && (
        <dl className="facts">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      )}

      <p className="details-source">
        {location && <>Sijainti päivitetty {ago(location.timestamp, now)}. </>}
        {status.remaining != null && <>Hakuja {AIR_PROVIDER.quotaPeriod} jäljellä {status.remaining}. </>}
        Lähde: {AIR_PROVIDER.name}, {AIR_PROVIDER.licence}
      </p>
    </div>
  );
}
