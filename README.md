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

## Julkaisu

Jokainen push haaraan `junat-mvp` tai `main` rakentaa ja julkaisee sovelluksen GitHub Pagesiin
(`.github/workflows/deploy.yml`): https://laippari.github.io/kartat/

Kertaluonteinen asetus: repon *Settings → Pages → Build and deployment → Source: GitHub Actions*.

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

## Artifact-versio (puhelimella esikatseluun)

claude.ai-artifact ajetaan suljetussa ympäristössä, joka ei saa yhteyttä Digitrafficiin eikä
karttatiilipalvelimeen. Siksi artifact-versio toistaa tallennetta: sama käyttöliittymä, mutta
data ja taustakartta pakataan sivun mukaan.

```sh
NODE_USE_ENV_PROXY=1 npm run data:artifact   # nauhoittaa ~8 min liikennettä, hakee aikataulut ja taustakartan
npm run build:artifact                       # dist-artifact/artifact.html + files.json
```

Vaihto tehdään `vite.config.ts`:ssä: `src/data/digitraffic.ts` → `src/artifact/digitraffic.ts`
(tallenteen toisto samoilla funktioilla) ja `src/map/style.ts` → `src/artifact/style.ts`.
