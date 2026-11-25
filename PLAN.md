# Skjutapp — Shot Group Analyzer (PWA)

## Context
New project (empty folder `/home/aki/Projekt/Skjutapp`). Goal: a shooter loads/takes a photo of a paper target, the app finds the bullet holes, and reports group statistics, ring score, and sight correction, with history saved on-device.

Decisions made with the user:
- **Platform:** Web app / PWA (phone + desktop, installable, camera capture)
- **Detection:** automatic hole detection + manual add/remove/move
- **Targets:** ISSF 25m/50m precision pistol target and ISSF 50m rifle target (ring scoring); square-grid paper (user enters grid square size); any target with manual 2-point scale
- **Stats:** extreme spread, mean radius, group-center offset, ring score, history over time
- **UI language:** English. **Storage:** local (IndexedDB) + JSON export/import

## Stack
- Vite + TypeScript + React
- OpenCV.js (`@techstark/opencv-js`), loaded in a **Web Worker** so the ~8 MB wasm never blocks the UI
- `vite-plugin-pwa` (offline + install), `idb` for IndexedDB
- Vitest for unit tests (geometry, stats, scoring, detection on synthetic images)

## Project layout
```
src/
  main.tsx, App.tsx              – routing between screens
  screens/
    ImportScreen.tsx             – file picker / camera (<input capture>), target type + caliber + distance
    CalibrateScreen.tsx          – show auto-found target/grid, let user drag 4 corners or 2 scale points
    AnalyzeScreen.tsx            – rectified image + hole markers (tap = add, tap marker = remove, drag = move), stats panel
    HistoryScreen.tsx            – session list, trend chart, export/import JSON
  targets/
    definitions.ts               – TargetDef: ring radii (mm), black-aim diameter, scoring rules
  vision/
    worker.ts                    – OpenCV worker: messages {rectify, detectHoles}
    rectify.ts                   – find black aim mark (ring targets) / 4-point homography (grid & manual)
    detectHoles.ts               – hole detection on the rectified image
  analysis/
    stats.ts                     – group statistics
    scoring.ts                   – ring score per shot
    units.ts                     – mm ↔ MOA ↔ MRAD at distance
  storage/db.ts                  – IndexedDB sessions (idb), export/import
  components/                    – TargetCanvas (pan/zoom, markers), StatsPanel, TrendChart
```

## Target definitions (`targets/definitions.ts`)
Everything is in mm in "target space"; the rectified image is mapped to a fixed px/mm scale (e.g. 4 px/mm).
- **ISSF 25m/50m precision pistol:** 10-ring Ø50 mm, each ring +50 mm Ø (1-ring Ø500), inner ten Ø25, black covers rings 7–10 (Ø200).
- **ISSF 50m rifle:** 10-ring Ø10.4 mm, each ring +16 mm Ø (1-ring Ø154.4), inner ten Ø5, black covers rings 3–10 (Ø112.4).
- **Grid paper:** user-entered square size (mm), user marks aim point; no ring score.
- **Manual:** user marks two points + known distance; no ring score.
(Check the ring dimensions against the current ISSF rulebook while building.)

## Pipeline
1. **Load**: downscale to ≤2000 px on the long side, fix EXIF rotation (`createImageBitmap(..., {imageOrientation:'from-image'})`).
2. **Rectify / scale** (`rectify.ts`)
   - Ring targets: grayscale → blur → Otsu threshold → largest roughly elliptical dark contour = black aim mark → `fitEllipse` → affine transform that turns the ellipse into a circle with the known diameter. This fixes moderate camera tilt. Center = aim point. If the detection's confidence is low, fall back to the user dragging a circle over the black area.
   - Grid: user drags 4 corners onto grid intersections and enters how many squares lie between them → `getPerspectiveTransform` → px/mm. Later: auto-detect grid lines with Hough.
   - Manual: 2 points + distance → scale only.
3. **Detect holes** (`detectHoles.ts`) on the rectified image, with the expected hole area taken from caliber × px/mm:
   - Split the image into a "black zone" mask and a "white zone" mask. Holes look light on black and dark on white, so each zone gets its own adaptive threshold (inverted for the white zone).
   - Morphological open/close, then find contours. Filter by area (0.4×–6× the expected size), circularity, and solidity, and reject ring lines and printed numbers (thin, low solidity).
   - Overlapping holes: if a blob's area ≈ k × the expected area, estimate k shots and seed k points (k-means on the blob's pixels). Flag these as "uncertain" so the user can check them.
   - Output: shot centers in mm relative to the aim point, plus a confidence for each.
4. **Manual correction** in `TargetCanvas`: tap empty space to add a shot, tap a marker to delete it, long-press and drag to move it. Stats recompute live.
5. **Analysis** (`stats.ts`, `scoring.ts`, `units.ts`)
   - Extreme spread (largest center-to-center pair distance), group width/height, mean radius, group center (mean x/y), offset from the aim point (Δx, Δy).
   - Everything shown in mm plus MOA and MRAD at the entered distance. Sight correction in clicks, from a user-set click value (e.g. ¼ MOA or 0.1 MRAD).
   - Ring score: a shot gets the higher ring if the hole edge touches the ring line, i.e. compare `dist − caliber/2` with the ring radius. Inner tens (X) are counted. Totals plus a per-shot list.
6. **Save session**: date, target type, distance, caliber, notes, shots (mm), stats, and a JPEG thumbnail of the rectified image → IndexedDB.
7. **History**: list with filters by target type; trend chart of extreme spread / mean radius / score over time; JSON export and import.

## Implementation order
1. Scaffold Vite + React + TS + PWA + Vitest; OpenCV worker that loads and answers a ping.
2. `analysis/*` + `targets/definitions.ts` with unit tests (pure math, written first).
3. Import screen + manual mode end-to-end (manual scale, tap shots → stats). This gives a usable app even before CV works.
4. Ring-target rectification + hole detection, tested on synthetic images drawn in tests and then on real photos.
5. Grid 4-point rectification.
6. Storage + history + trend chart; PWA manifest/icons.

## Verification
- `npm test` (Vitest):
  - stats on known point sets (e.g. a square of 4 shots → known extreme spread and mean radius)
  - scoring at ring-line edge cases
  - MOA/MRAD conversions
  - detection on synthetic targets: draw an ISSF target plus N circles with OpenCV, perspective-warp them, and assert ≥95 % of holes are found within 1 mm
- `npm run dev` → load real target photos (the user supplies a few), check that the detected holes match, correct them manually, and check that scores match a hand count.
- `npm run build && npm run preview` → check the app installs as a PWA, works offline, and that the camera capture opens on a phone (over LAN with `--host`).
- Save sessions, reload the page, and confirm the history and trend chart persist; check that JSON export → import round-trips.
