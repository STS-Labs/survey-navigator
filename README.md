# Survey Navigator

Turn-by-turn navigation on an iPhone for street-coverage routes: the kind of GPX a survey car follows
when it has to drive every street of an area, passing the same junctions several times.

Ordinary apps (OsmAnd, Google Maps) draw the whole day's line at once, so at a junction the driver sees
three or four branches and cannot tell which one is now. This app shows only the road ahead, says each
turn, never jumps to another pass of the same street, brings the driver back to the exact spot when a
turn is missed, and keeps a record of what was really driven.

## For the driver

1. Open the app's web address in Safari, then Share → Add to Home Screen.
2. Put the day's GPX on the phone (AirDrop, WhatsApp or Telegram → Save to Files).
3. Open the app → **Open route file (GPX)** → pick the file. The file stays on the phone.
4. Mount the phone, connect the charger, tap **Start navigation**.
   iPhone setting: Display & Brightness → Auto-Lock → Never.

On the map: **blue** = the road ahead (bold for the next 300 m), white arrow = the next turn,
**orange** = the way back after a missed turn, **red dashes** = stretches missed so far.

Menu: skip to the next turn (closed street), go back one turn, continue from where I am, the missed list,
send missed stretches / the driven track as GPX, voice and language, practice drive (simulation).

## How it works

| Step | What happens | Where |
| --- | --- | --- |
| Read the GPX | track points (or route points) in file order | `js/core.js` `parseGpx` |
| Match to streets | every point is placed on the OpenStreetMap street network; gaps between points are filled along the streets | `buildRoute` |
| Turn list | at each junction: turn if the route turns and another street leaves there; *keep left/right* at forks; roundabouts get one instruction with the exit number; U-turns at the turn-back point | `detectManeuvers` |
| Where am I | each GPS fix is matched only to the part of the route the car could have reached since the last fix, so a later pass of the same street never wins | `Navigator.update` |
| Missed a turn | legal way back (one-way streets, OSM turn bans, U-turns discouraged) to the junction where the car left | `findWayBack` |
| Coverage | the route is kept in 10 m pieces, ticked off from the car's own GPS track; anything behind the car not ticked is on the missed list | `Navigator.coverage` |

Street data: `data/tbilisi-net.json`, all drivable OpenStreetMap streets of Tbilisi with names, one-way
flags and turn restrictions (3.9 MB, 1.3 MB compressed). Map tiles: OpenFreeMap. Both are kept on the
phone by `sw.js`, so a dead spot does not stop navigation. Outside Tbilisi the app still works, with
arrows from the line's shape only.

## Rebuilding the street data

```bash
uv run --with osmium python -I tools/build_network.py <georgia-latest.osm.pbf> data/tbilisi-net.json
```

Get the extract from https://download.geofabrik.de/europe/georgia-latest.osm.pbf.

## Checks

```bash
node tests/route_check.mjs day.gpx data/tbilisi-net.json      # matching and turn-list numbers
node tests/plan_check.mjs day.gpx data/tbilisi-net.json       # wrong-way, banned turns, private streets, U-turns
node tests/drive_test.mjs day.gpx data/tbilisi-net.json       # whole-day simulated drives, pass/fail
node tests/junction_sheet.mjs day.gpx data/tbilisi-net.json out.html all   # one drawing per instruction
```

`drive_test` drives the whole day in simulation: clean GPS, 9 m GPS noise, a missed turn every 20
instructions, two-minute GPS gaps, and a driver who ignores the way back. The test that matters most is the
coverage audit: every metre of the route must be either really driven or on the missed list.

## Running it locally

Any static server, e.g. `python3 -m http.server 8790`, then http://localhost:8790. The phone needs the
app on an `https://` address for GPS (any static host works; nothing runs on a server).

## Credits

Street data © OpenStreetMap contributors, available under the Open Database License (ODbL).
Map tiles: OpenFreeMap, OpenMapTiles. Map library: MapLibre GL JS (BSD-3-Clause, `vendor/`).
