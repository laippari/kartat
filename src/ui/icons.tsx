import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const ArrowRight = () => (
  <svg {...base}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Close = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const Plus = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Minus = () => (
  <svg {...base}>
    <path d="M5 12h14" />
  </svg>
);

export const Locate = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const Follow = () => (
  <svg {...base}>
    <path d="M12 3l7 18-7-4-7 4 7-18z" />
  </svg>
);

export const Chevron = ({ up }: { up?: boolean }) => (
  <svg {...base} style={{ transform: up ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
