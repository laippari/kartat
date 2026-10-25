import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useMediaQuery } from '../lib/hooks';

type Snap = 'half' | 'full';

interface Props {
  open: boolean;
  label: string;
  header: ReactNode;
  children: ReactNode;
  onClose(): void;
  /** How much of the screen the sheet covers, so the map can keep its subject in view. */
  onCover(cover: { right: number; bottom: number }): void;
}

const TOP_GAP = 56;
const HALF_SHARE = 0.46;
const PANEL_WIDTH = 400;
const PANEL_MARGIN = 12;

/**
 * Bottom sheet on small screens, side panel on larger ones. Non-modal: the
 * map stays usable behind it.
 */
export function Sheet({ open, label, header, children, onClose, onCover }: Props) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [snap, setSnap] = useState<Snap>('half');
  const [dragY, setDragY] = useState<number | null>(null);
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const drag = useRef<{ startY: number; startOffset: number; lastY: number; lastT: number; velocity: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (open) setSnap('half');
  }, [open]);

  const height = viewport - TOP_GAP;
  const offsets: Record<Snap, number> = { full: 0, half: Math.round(height - viewport * HALF_SHARE) };
  const offset = !open ? height : (dragY ?? offsets[snap]);

  useLayoutEffect(() => {
    if (wide) onCover({ right: open ? PANEL_WIDTH + PANEL_MARGIN * 2 : 0, bottom: 0 });
    else onCover({ right: 0, bottom: open ? Math.round(viewport * HALF_SHARE) : 0 });
    // The map only needs to know about settled positions, not every drag frame.
  }, [wide, open, viewport]);

  useEffect(() => {
    if (snap === 'half') scroller.current?.scrollTo({ top: 0 });
  }, [snap]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (wide || e.button !== 0) return;
    // In the full state the content scrolls; only the header moves the sheet.
    if (snap === 'full' && !(e.target as HTMLElement).closest('[data-sheet-handle]')) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a') && !target.closest('.sheet-grip')) return;
    drag.current = { startY: e.clientY, startOffset: offsets[snap], lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const next = d.startOffset + e.clientY - d.startY;
    // Resist pulling past the top.
    setDragY(next < 0 ? next / 4 : next);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const moved = Math.abs(e.clientY - d.startY);
    const position = dragY ?? offsets[snap];
    setDragY(null);
    if (moved < 6) {
      // A tap on the handle toggles between the two heights.
      if ((e.target as HTMLElement).closest('[data-sheet-handle]')) setSnap(snap === 'half' ? 'full' : 'half');
      return;
    }
    const fling = Math.abs(d.velocity) > 0.5;
    if (fling && d.velocity > 0) {
      if (snap === 'full' && position < offsets.half) setSnap('half');
      else onClose();
    } else if (fling) {
      setSnap('full');
    } else if (position > offsets.half + (height - offsets.half) / 3) {
      onClose();
    } else {
      setSnap(position < offsets.half / 2 ? 'full' : 'half');
    }
  };

  if (wide) {
    return (
      <aside className={`panel${open ? ' is-open' : ''}`} aria-label={label} aria-hidden={!open} inert={!open}>
        <div className="sheet-header">{header}</div>
        <div className="sheet-body">{children}</div>
      </aside>
    );
  }

  return (
    <aside
      className={`sheet is-${snap}${dragY !== null ? ' is-dragging' : ''}`}
      style={{ height, transform: `translate3d(0, ${offset}px, 0)` }}
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="sheet-header" data-sheet-handle>
        <button
          type="button"
          className="sheet-grip"
          aria-label={snap === 'half' ? 'Laajenna' : 'Pienennä'}
          // Pointer taps are handled with the drag; this covers the keyboard.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSnap(snap === 'half' ? 'full' : 'half');
            }
          }}
        />
        {header}
      </div>
      <div className="sheet-body" ref={scroller}>
        {children}
      </div>
    </aside>
  );
}
