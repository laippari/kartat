// Warm greyscale with a few muted autumn colours from Finnish nature, shared by
// the map and the interface. Keep in sync with app.css.
//
// Each colour has one job, so it can be read at a glance:
//   ink      – long-distance trains, and text
//   lake     – commuter trains
//   spruce   – freight trains (much of it timber)
//   heather  – whatever you are focused on: the selected train, the next stop, your location
//   lingon   – delays and cancellations, nothing else
// Everything else on the map (stations, rails, water, places) stays grey.
export const palette = {
  paper: '#faf9f6',
  paperDeep: '#f2f0eb',
  water: '#e1e6e6',
  hairline: '#e1ded7',
  road: '#ebe8e2',
  rail: '#a8a49b',
  railMinor: '#cdc9c1',
  muted: '#8c887f',
  inkSoft: '#4b4842',
  ink: '#161513',
  lake: '#2f6597',
  spruce: '#3e6b4e',
  heather: '#6d5fa3',
  lingon: '#b4383c',
} as const;
