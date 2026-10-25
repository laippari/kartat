# Kartat – junat kartalla

Suomen junat kartalla reaaliajassa. Ensimmäinen vaihe laajemmasta ideasta: kaikki
Suomen avoimista rajapinnoista löytyvä liikkuva liikenne yhdellä kartalla.

## Käynnistys

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # yksikkötestit
npm run build      # tuotantoversio hakemistoon dist/
```

Sovellus toimii kokonaan selaimessa, eikä se tarvitse API-avaimia.

## Tietolähteet

| Mitä | Mistä | Miten |
|---|---|---|
| Junien GPS-sijainnit | Digitraffic, MQTT `train-locations/#` | Live-virta WebSocketin yli, ensin REST `train-locations/latest` |
| Kulkevat junat (tyyppi, reitti, myöhästyminen) | Digitraffic GraphQL `currentlyRunningTrains` | Päivitys minuutin välein |
| Junan aikataulu | Digitraffic REST `trains/{pvm}/{numero}` | Päivitys 20 s välein, kun tiedot ovat auki |
| Liikennepaikat | Digitraffic REST `metadata/stations` | Kerran |
| Rataverkko (yleiskuva) | Digitraffic infra-api `radat.geojson` | Kevennetty valmiiksi tiedostoon `public/data/rail-network.geojson` (`npm run data:rail`) |
| Taustakartta | OpenFreeMap (OpenMapTiles) | Oma tyyli `src/map/style.ts` |

Junadata: Fintraffic / digitraffic.fi, CC BY 4.0. Rataverkko: Väylävirasto / digitraffic.fi, CC BY 4.0.
Kartta: © OpenMapTiles © OpenStreetMap.

## Rakenne

- `src/data/` – rajapintakutsut (`digitraffic.ts`) ja junien tila (`trainStore.ts`). Sijainnit liu'utetaan
  päivitysten välillä, jotta pisteet liikkuvat tasaisesti.
- `src/map/` – MapLibre-kartta, tyyli ja kerrokset.
- `src/ui/` – kortti, alapaneeli/sivupaneeli, selite ja karttapainikkeet.
- `src/lib/` – muotoilu ja aikataulun käsittely (testit vieressä).
- `src/styles/` – värit (`palette.ts` kartalle, `app.css` käyttöliittymälle; pidä samoina).
