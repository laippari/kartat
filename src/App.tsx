import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { MapView, type MapApi, type MapPadding } from './map/MapView';
import { trainStore, useTrainStore } from './data/trainStore';
import { isTransitKey, type Category, type TrainKey } from './data/types';
import { Legend } from './ui/Legend';
import { MapControls } from './ui/MapControls';
import { Sheet } from './ui/Sheet';
import { TrainCard } from './ui/TrainCard';
import { TransitDetails } from './ui/TransitDetails';
import { TrainDetails, TrainHeader } from './ui/TrainDetails';

// A selected train is kept in the address, e.g. #juna_2026-10-25_27, so a view can be shared.
// Kept to plain characters: the artifact viewer passes on only simple anchors.
const HASH_PREFIX = '#juna_';
const hashFor = (key: TrainKey) => HASH_PREFIX + key.replace('/', '_');
const keyFromHash = () =>
  location.hash.startsWith(HASH_PREFIX) ? location.hash.slice(HASH_PREFIX.length).replace('_', '/') : null;

// What the viewer chose to show is remembered on this device.
const HIDDEN_KEY = 'kartat.hidden';

function loadHidden(): ReadonlySet<Category> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveHidden(hidden: ReadonlySet<Category>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Storage may be blocked; the choice then lasts until the page is closed.
  }
}

function replaceHash(hash: string) {
  try {
    history.replaceState(null, '', hash || location.pathname + location.search);
  } catch {
    // Sandboxed frames may refuse history changes; the link is a convenience.
  }
}

export function App() {
  const [selectedKey, setSelectedKey] = useState<TrainKey | null>(null);
  const [hoveredKey, setHoveredKey] = useState<TrainKey | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<Category>>(loadHidden);
  const [cover, setCover] = useState<MapPadding>({ right: 0, bottom: 0 });
  const map = useRef<MapApi | null>(null);
  const { ready } = useTrainStore();
  // Keeps the sheet's content in place while it slides away after closing.
  const lastSelected = useRef<TrainKey | null>(null);
  if (selectedKey) lastSelected.current = selectedKey;
  const sheetKey = selectedKey ?? lastSelected.current;

  useEffect(() => trainStore.start(), []);

  const select = useCallback((key: TrainKey | null) => {
    setSelectedKey(key);
    if (!key) {
      setDetailsOpen(false);
      setFollowing(false);
    }
  }, []);

  const openDetails = () => {
    setDetailsOpen(true);
    setFollowing(true);
  };

  const close = useCallback(() => select(null), [select]);

  // Open a shared link once the train shows up in the data.
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    const key = keyFromHash();
    if (!ready || !mapReady || !key) return;
    if (trainStore.getLocation(key)) {
      setSelectedKey(key);
      setDetailsOpen(true);
      setFollowing(true);
      map.current?.showTrain(key);
    } else {
      replaceHash('');
    }
  }, [ready, mapReady]);

  useEffect(() => {
    if (!ready) return;
    // Metro and tram runs are not linked: they last minutes, and their ids are long.
    const hash = selectedKey && detailsOpen && !isTransitKey(selectedKey) ? hashFor(selectedKey) : '';
    if (location.hash !== hash) replaceHash(hash);
  }, [ready, selectedKey, detailsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const updateHidden = (next: Set<Category>) => {
    setHidden(next);
    saveHidden(next);
  };

  const toggleCategory = (category: Category) => {
    const next = new Set(hidden);
    if (!next.delete(category)) next.add(category);
    updateHidden(next);
  };


  const locate = () =>
    new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setFollowing(false);
          map.current?.showUser([p.coords.longitude, p.coords.latitude]);
          resolve();
        },
        reject,
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      );
    });

  // The floating card shows the hovered train, or the selected one until its details are open.
  const cardKey = hoveredKey ?? (detailsOpen ? null : selectedKey);

  return (
    <div className="app" style={{ '--cover-right': `${cover.right}px` } as CSSProperties}>
      <MapView
        selectedKey={selectedKey}
        cardKey={cardKey}
        card={
          cardKey && (
            <TrainCard key={cardKey} trainKey={cardKey} pinned={cardKey === selectedKey} onOpen={openDetails} />
          )
        }
        hidden={hidden}
        following={following}
        padding={cover}
        onHover={setHoveredKey}
        onSelect={select}
        onUserMove={() => setFollowing(false)}
        onReady={(api) => {
          map.current = api;
          setMapReady(true);
        }}
      />

      <Legend hidden={hidden} onToggle={toggleCategory} />

      <MapControls
        onZoomIn={() => map.current?.zoomIn()}
        onZoomOut={() => map.current?.zoomOut()}
        onLocate={locate}
      />

      <Sheet
        open={detailsOpen && selectedKey !== null}
        label={sheetKey && isTransitKey(sheetKey) ? 'Metron tai ratikan tiedot' : 'Junan tiedot'}
        onClose={close}
        onCover={setCover}
        header={
          sheetKey && (
            <TrainHeader
              trainKey={sheetKey}
              following={following}
              onFollow={() => setFollowing(!following)}
              onClose={close}
            />
          )
        }
      >
        {sheetKey &&
          (isTransitKey(sheetKey) ? (
            <TransitDetails key={sheetKey} trainKey={sheetKey} />
          ) : (
            <TrainDetails key={sheetKey} trainKey={sheetKey} />
          ))}
      </Sheet>
    </div>
  );
}
