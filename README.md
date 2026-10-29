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

## Quick Start

```bash
# Install dependencies
npm install

# (Optional) Manually force a fresh sync from NASA, CelesTrak, and HYG archives
npm run sync-data

# Launch both the Continual Sync/Image Proxy API (port 8787) and Vite Web App (port 5173)
npm run dev
```

For a single-process production build:
```bash
npm run build
npm run preview
```
