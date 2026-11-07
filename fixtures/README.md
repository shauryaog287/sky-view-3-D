# Fixtures

`adsb-v2/*.json` are real ADS-B snapshots in the readsb "v2" format, recorded around the preset airports with
`npm run data:fixtures`. Fields not used by the app were dropped to keep them small.

- **Source:** [adsb.lol](https://adsb.lol) community network.
- **Licence:** Open Database License (ODbL 1.0). Attribution: "Contains data from adsb.lol, available under the ODbL."
- They power mock mode (`npm run dev:mock`), the Worker's `FixtureProvider` (`PROVIDERS=fixture`) and parser tests.
