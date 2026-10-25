let source: () => number = Date.now;

/** Current time in ms. The artifact build swaps in the clock of its recorded replay. */
export const now = () => source();

export function setClock(clock: () => number) {
  source = clock;
}
