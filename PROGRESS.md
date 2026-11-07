# Progress

Legend: ✅ done · 🔄 in progress · ⏳ not started · ⛔ blocked (see NEEDS_FROM_ME.md)

| Milestone | Status | Notes |
| --- | --- | --- |
| M1 Scaffold, globe, fallback tiles, CI, tests | ✅ | Offline Natural Earth globe works with zero keys |
| M2 Backend, providers, caching, live aircraft | ✅ | Live adsb.lol data verified end-to-end through `wrangler dev`; airplanes.live ⛔ needs approval email |
| M3 Motion, models, cameras, info panel, search | ✅ | Chase / orbit / cockpit verified in headless Chromium (tablet + phone); adsbdb enrichment live |
| M4 Airports, phase detection, takeoff/landing, Google tiles | ✅ | Tower/runway cams verified on the scripted DEL 28 arrival. Google tiles path is coded but ⛔ untested without a key (NEEDS_FROM_ME §3) |
| M5 Weather/sky, quality, performance | ✅ | Haze fog verified with live Delhi METAR (1.1 km HZ); clouds at METAR base; settings sheet. GPU perf on a real Android device still to be measured |
| M6 Track storage, replay, alerts | ✅ | D1 track write/read + cron verified under `wrangler dev`; push crypto verified vs RFC 8291; real push delivery ⛔ needs VAPID keys + a device (NEEDS_FROM_ME §6) |
| M7 Auth, feature flags, paywall (off), Razorpay test, analytics | ✅ | Paywall flow verified end-to-end in mock mode (e2e); JWT + Razorpay signatures/webhooks unit-tested. Real Supabase/Razorpay round-trips ⛔ need accounts (NEEDS_FROM_ME §7–8) |
| M8 PWA polish, legal, deploy, README | 🔄 | Service worker, manifest and icons landed with M6 (push needs them) |
