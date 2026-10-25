import { useState } from 'react';
import { Locate, Minus, Plus } from './icons';

interface Props {
  onZoomIn(): void;
  onZoomOut(): void;
  onLocate(): Promise<void>;
}

export function MapControls({ onZoomIn, onZoomOut, onLocate }: Props) {
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);

  const locate = () => {
    setLocating(true);
    onLocate()
      .then(() => setLocateFailed(false))
      .catch(() => setLocateFailed(true))
      .finally(() => setLocating(false));
  };

  return (
    <div className="controls">
      <div className="control-group zoom-group">
        <button type="button" className="control" aria-label="Lähennä" title="Lähennä" onClick={onZoomIn}>
          <Plus />
        </button>
        <button type="button" className="control" aria-label="Loitonna" title="Loitonna" onClick={onZoomOut}>
          <Minus />
        </button>
      </div>
      <div className="control-group">
        <button
          type="button"
          className={`control${locating ? ' is-busy' : ''}`}
          aria-label={locateFailed ? 'Sijaintia ei saatu. Yritä uudelleen' : 'Näytä oma sijainti'}
          title={locateFailed ? 'Sijaintia ei saatu' : 'Oma sijainti'}
          onClick={locate}
        >
          <Locate />
        </button>
      </div>
    </div>
  );
}
