# India-first rollout

Order: Indian international airports → other Indian airports with airline service → international hubs.
The aircraft "replica" list below is what to source (see NEEDS_FROM_ME §16) so every flight seen in India is drawn
with its real type **and** its operator's livery. Fleets change. Check each airline's current fleet page before buying.

## Airports

| Phase | Airports | 3D scenery | Runways / runway in use |
| --- | --- | --- | --- |
| 1 | 39 Indian international airports (`shared/indiaAirports.ts` → `INDIA_INTERNATIONAL`) | Pre-built, shipped in `public/airports3d/` | OurAirports runway data, aligned sideways to the OpenStreetMap centreline for lighting; runway in use learned live |
| 2 | 83 other Indian airports with an IATA code (`indiaDomestic()`) | Pre-built, shipped | Same |
| 3 | 134 international hubs (`shared/worldHubs.ts`: Gulf, South and South-East Asia, East Asia, Europe, Americas, Africa, Oceania) | Pre-built, shipped | Same |
| 4 | Every other airport | Built on demand by `/api/airport3d/:icao` (cached 7 days). Airfield lighting needs no scenery data, so every airport with runway data has it. | Same |

Rebuild or extend with `npm run data:airport3d -- --all` (downloads once into `.cache/osm/`, then `--rebuild` works
offline). 256 airports are shipped today (9 MB of JSON, each loaded only when the camera is near).

Photoreal buildings and terrain at each airport depend on Google Photorealistic 3D Tiles coverage (NEEDS_FROM_ME §3).
Coverage in India is uneven. Once the key is in, check each phase-1 airport and list the ones that are still flat;
those keep the OpenStreetMap 3D scenery.

## Aircraft replicas to source: Indian operators first

| Priority | Operator (ICAO) | Types (ICAO designators) |
| --- | --- | --- |
| 1 | IndiGo (IGO) | A20N, A21N, AT76, A320 (few left); widebodies as they arrive (A350-900 on order; leased B789) |
| 1 | Air India (AIC) | A20N, A21N, A320, A319, A321, B788, B789, B77L, B77W, A359 |
| 1 | Air India Express (AXB) | B38M, B738, A20N, A320 |
| 1 | Akasa Air (AKJ) | B38M |
| 1 | SpiceJet (SEJ) | B738, B38M, DH8D |
| 2 | Alliance Air (LLR) | AT76, AT46, D228 |
| 2 | Star Air (SDG) | E75L, E145 |
| 2 | Fly91, flybig, IndiaOne Air | AT76, DHC6, C208 |

Unique types in this table: about 17. Operator × type combinations: about 35.

## Foreign operators most seen at Indian airports

| Priority | Operator (ICAO) | Types |
| --- | --- | --- |
| 3 | Emirates (UAE) | A388, B77W |
| 3 | Qatar Airways (QTR) | B77W, B788, B789, A359, A35K, A320 |
| 3 | Etihad (ETD) | B789, B78X, A21N |
| 3 | flydubai (FDB) | B38M, B738 |
| 3 | Air Arabia (ABY) | A320, A21N |
| 3 | Saudia (SVA) | B77W, B789, A20N |
| 3 | Singapore Airlines (SIA) | A359, B77W, B38M |
| 4 | Thai, Malaysia, Cathay, SriLankan, Oman Air, Gulf Air, Kuwait, Biman, Nepal Airlines | per their fleet pages |
| 4 | Lufthansa, British Airways, Air France, KLM, Virgin Atlantic, Turkish, United, American, Air Canada | widebodies on India routes (B77W, B789, A359, A35K, B748, A346, A333) |

Aircraft without a replica keep the generated model of their exact type, with the operator's colour on the tail.
The app picks the model per flight from live data: callsign → operator, ADS-B type → model
(`shared/aircraftModels.ts` → `resolveModel`).
