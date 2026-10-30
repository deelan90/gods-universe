# GOD'S UNIVERSE // Multi-Scale Observable Cosmos Observatory

An interactive, tactical 3D map and live telemetry observatory of the **Observable Universe**—inspired by [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view)—spanning **22+ orders of magnitude** seamlessly in a single continuous WebGL space from Low Earth Orbit satellites (`~400 km`) out to the Cosmic Microwave Background (`46.5 Billion Light-Years`).

## Core Capabilities

- **Continuous Multi-Scale 3D Engine**: Camera-relative 64-bit floating-origin coordinate system + logarithmic depth buffer (`10 km` to `100 Billion ly` with zero Z-fighting), running smoothly across desktop and mobile browsers.
- **Authoritative Public Astronomical Data Feeds**:
  - **NASA Exoplanet Archive (Caltech/IPAC TAP API)**: 6,400+ confirmed exoplanets with real 3D coordinates, radii (`× R⊕`), masses (`× M⊕`), equilibrium temperatures, orbital periods, stellar luminosities, habitable zones, and discovery facilities (JWST, TESS, Kepler, ESO).
  - **NORAD / CelesTrak Live Satellites (`satellite.js` SGP4)**: 450+ active spacecraft (ISS, Tiangong, Hubble, Chandra, GPS, Starlink, Weather) propagated in real time around a sidereal-rotating 3D Earth.
  - **High-Precision Solar System Ephemeris (`astronomy-engine`)**: Live J2000 3D positions of the Sun, 8 Planets, Moon, Pluto, JWST (L2), and Voyager 1.
  - **Astronexus HYG v40 + Hipparcos / Gaia 3D Star Catalog**: 6,800+ stars with true 3D Cartesian interstellar distances, spectral classes (`O–M`), luminosities, and circumstellar Habitable Zone rings.
  - **88 IAU 3D Constellations & 12 Zodiac Star Signs**: True 3D star-to-star constellation vectors that align into classic sky constellations from Earth and unfold into 3D depth as you travel through space.
  - **Deep-Space Landmarks, Milky Way Spiral Arms, Cosmic Web & 46.5-Gly CMB Horizon**.
- **Clever 2.5D / Pseudo-3D Telescope Image Perspective Synthesis**:
  - Custom GLSL shaders transform 2D JWST, Hubble, Cassini, Voyager, and Event Horizon Telescope captures into volumetric 3D-perspective objects (both **3D Spherical Planetary Lensing** and **8-Layer Steep Parallax Relief**) directly in 3D space and inside an interactive 3D Inspector Modal.
- **"Google Maps for the Universe" Distance & Travel Calculator**:
  - Pinned to **Earth** by default (or swappable to *any* celestial object in the cosmos) to measure live 3D distances (`km`, `AU`, `ly`, `Mpc`, `Gly`) and travel durations at the Speed of Light, Parker Solar Probe, Voyager 1, and Commercial Airliner speeds.
- **Real-Time Solar System Speed & Helical Motion Visualizer**:
  - Live ticking kilometer odometers for Earth's solar orbit (`29.78 km/s`), the Solar System's Milky Way orbit (`230.0 km/s`), and our velocity relative to the Cosmic Microwave Background (`369.82 km/s`), paired with a toggleable **3D Helical Corkscrew Trail & Streaming Velocity Lattice** across any time scale (`1× Real-Time` to `31.5M×`).
- **Multi-Metric Filtering, Highlighting & Grouping**:
  - Filter out, highlight, or color-group Rocky planets, Super-Earths, Ice/Gas Giants, Lava Worlds, custom **Earth-Size Multipliers (`0.1×–25× R⊕`)**, Habitable Zone worlds, Star Sizes (`R☉`), Spectral Classes (`O–M`), Satellites, and Deep-Space categories.
- **Continual Auto-Sync Daemon**:
  - Automatically checks public data archives every **72 hours (3 days)** (configurable to 24h / 72h / 7d, plus manual 1-click sync) to pull newly confirmed exoplanets and fresh satellite orbital elements.

## What's new (v1.1)

### Live spacecraft tracker (press `T`)
- **Space stations** — the ISS and Tiangong (plus any new commercial station that appears in the NORAD catalogue) with live latitude/longitude, altitude, speed, sunlight/shadow, and a world map with the last 45 minutes and next 90 minutes of ground track. Orbits refresh straight from CelesTrak in the browser when the synced copy is more than 6 hours old.
- **Deep space** — Voyager 1 & 2, New Horizons, Pioneer 10 & 11, Parker Solar Probe, Solar Orbiter, JWST, Euclid, BepiColombo, Hera, Psyche, Lucy, Europa Clipper, JUICE, Juno, Curiosity and Perseverance. Shows distance from Earth and the Sun, one-way radio delay, and speed. All of them are drawn in the 3D scene and are searchable.
- Positions come from **NASA/JPL Horizons** state vectors (refreshed every 6 hours by `npm run sync-live`) and are Hermite-interpolated in real time. If the file is missing or out of range, a built-in two-body Kepler propagator (seeded with Horizons vectors from 30 Oct 2026) takes over, so the app never shows a stale position.

### Weather on other worlds (press `M`)
- **Mars** — the latest Curiosity REMS daily report from Gale Crater (air and ground temperature, pressure, sky, UV, sunrise/sunset, recent trend), plus today's Mars season, local solar time at Gale and Jezero, and dust-storm season (Mars24 / Allison & McEwen algorithm).
- **The Sun** — live space weather from NOAA SWPC: solar-wind speed, Kp geomagnetic index, X-ray flare class and NOAA R/S/G scales.
- **Every other planet, Titan and Pluto** — today's distance from the Sun, sunlight strength and signal delay, with typical conditions clearly labelled as typical.

### Navigation
- **Command palette** (`/` or `Ctrl/⌘ K`) — search 10,000+ objects, recent searches, popular destinations, and every action (zoom presets, layers, panels).
- **Tool rail** on the left (icons on mobile); one panel open at a time.
- **Shareable links** — the address bar follows your selection (`#/o/voyager-1`).
- **Keyboard shortcuts** — press `?` in the app for the full list. `1`–`7` jump between zoom levels, `H` goes home, `P` pauses time, `L` returns to live time.

## Data refresh schedule

| Data | Source | How often |
| --- | --- | --- |
| Exoplanets, stars, satellites, deep sky | NASA Exoplanet Archive, HYG, CelesTrak, OpenNGC | Every 3 days (`npm run sync-data`) |
| Spacecraft positions, Mars weather, station orbits | JPL Horizons, NASA/CAB REMS, CelesTrak | Every 6 hours (`npm run sync-live`) |
| Space weather | NOAA SWPC | Live in the browser, every 5 minutes |
| Station orbits (fallback) | CelesTrak | Live in the browser when older than 6 hours |

The GitHub Actions workflow runs both schedules. Live data ships with each Pages deploy and is not committed, so the 6-hour refresh doesn't add commits.

## Quick Start

```bash
# Install dependencies
npm install

# (Optional) Manually force a fresh sync from NASA, CelesTrak, and HYG archives
npm run sync-data

# (Optional) Refresh only spacecraft positions, Mars weather and station orbits
npm run sync-live

# Launch both the Continual Sync/Image Proxy API (port 8787) and Vite Web App (port 5173)
npm run dev
```

For a single-process production build:
```bash
npm run build
npm run preview
```
