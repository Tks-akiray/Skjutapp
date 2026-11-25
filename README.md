# Skjutapp — shot group analyzer

A web app (installable PWA) that analyzes shot groups from photos of paper targets.
Everything runs in the browser, so no photos leave the device. Sessions are stored
locally in IndexedDB.

## Features

- **Targets**: ISSF 25 m / 50 m precision pistol, ISSF 50 m rifle, square grid paper
  (you enter the square size), or any target with a manual two-point scale.
- **Automatic hole detection** (OpenCV.js in a Web Worker), plus manual correction:
  tap to add, tap to select, drag to move, Delete / Undo.
- **Perspective correction**:
  - Ring targets: the black aiming mark is found automatically and the image is
    rectified, then refined by fitting a homography to the ring lines (residual ≈ 0.1–0.5 mm).
  - Grid targets: you mark 4 corners of a rectangle of N×M squares.
- **Statistics**: group size (center-to-center and outside-to-outside), width × height,
  mean radius, group center offset, all in mm, MOA and mrad. Sight correction in clicks.
- **Ring score**: integer and decimal score, inner tens (X). A hole touching a ring
  line scores the higher value (gauging by bullet diameter).
- **History**: saved sessions, a trend chart (group size / mean radius / average score
  over time), and JSON export/import.

## Running

```sh
npm install
npm run dev        # development server
npm test           # unit + vision pipeline tests (Vitest)
npm run build      # production build → dist/
npm run preview    # serve the production build
```

To try it on a phone, run `npm run dev -- --host` and open the LAN address. Note that
installing the app as a PWA and working offline need HTTPS (or `localhost`). Serve
`dist/` over HTTPS for that.

## Project layout

```
src/
  analysis/      geometry, group stats, scoring, MOA/MRAD + sight correction
  targets/       target definitions (ISSF ring dimensions)
  vision/        OpenCV pipeline (runs in a worker)
    rectify.ts       aim-mark detection, ellipse/quad/scale rectification
    ringRefine.ts    ring-line homography refinement (Levenberg–Marquardt)
    detectHoles.ts   hole detection (top/black-hat, opening, shape checks, overlap split)
    worker.ts, client.ts, protocol.ts
  storage/       IndexedDB sessions, settings (localStorage)
  screens/       Import → Calibrate → Analyze, History
  components/    ZoomCanvas (pan/zoom/tap/drag), StatsPanel, TrendChart
test/            unit tests + synthetic-photo pipeline tests
```

The vision tests draw synthetic ISSF and grid targets with holes, printed numbers and
ring lines, warp them into skewed "photos" with lighting gradients and noise, and check
that every hole is found within 1.5 mm (pistol) / 0.75 mm (rifle) with no false positives.

## Known limitations

- Detection has been tuned on synthetic photos. Real photos (torn paper, dark backers,
  glare) will need tuning; the **Sensitivity** slider and manual editing cover the gaps.
- Overlapping holes are split by area and shape. They are marked orange ("to check").
- Ring-target ring dimensions follow the ISSF rules (pistol: 10-ring Ø50 mm, +50 mm per
  ring, black Ø200 mm; rifle 50 m: 10-ring Ø10.4 mm, +16 mm per ring, black Ø112.4 mm).
