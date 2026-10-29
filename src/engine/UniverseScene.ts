import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  ConstellationRecord,
  DeepSpaceBundle,
  DeepSpaceRecord,
  ExoplanetRecord,
  LayerVisibility,
  OpticalMode,
  SatelliteRecord,
  SolarSystemBody,
  StarRecord,
  UnifiedCelestialObject,
  UniverseFilters,
} from '../types/universe';
import {
  AU_PER_LY,
  compileSatellites,
  computeOrbitRingLy,
  computeSatelliteOrbitTrackKm,
  computeSolarSystemPositionsLy,
  EARTH_ORBIT_SPEED_KMS,
  exoplanetColorFromType,
  getEarthSiderealRotationRad,
  KM_PER_LY,
  propagateSatelliteOffsetKm,
  RENDER_KM_UNIT,
  RENDER_UNITS_PER_AU,
  RENDER_UNITS_PER_LY,
  SOLAR_CMB_APEX_DIR,
  SOLAR_CMB_SPEED_KMS,
  SOLAR_GALACTIC_APEX_DIR,
  SOLAR_GALACTIC_SPEED_KMS,
  starColorFromTempOrClass,
  type CompiledSatellite,
} from '../utils/astronomy';
import {
  createCosmicPointsMaterial,
  createHabitableZoneMaterial,
  createProceduralPlanetMaterial,
  createStarSurfaceMaterial,
  createTelescope25DMaterial,
} from './shaders';
import { resolveWebGLTextureUrls } from '../utils/nasaImagesClient';

export interface ProjectedHudMarker {
  id: string;
  name: string;
  tag?: string;
  color: string;
  x: number;
  y: number;
  category: string;
  isZodiac?: boolean;
  isHighlighted?: boolean;
}

export interface SceneTelemetrySnapshot {
  scaleLabel: string;
  cameraSpanLabel: string;
  simTimeMs: number;
  realElapsedSec: number;
  simElapsedSec: number;
  earthTraveledKm: number;
  galacticTraveledKm: number;
  cmbTraveledKm: number;
  originPosLy: [number, number, number];
  targetPosLy: [number, number, number] | null;
  fps: number;
  matchedCounts: {
    exoplanets: number;
    stars: number;
    satellites: number;
  };
}

interface UniverseSceneCallbacks {
  onSelectObject: (id: string) => void;
  onMarkersUpdate: (markers: ProjectedHudMarker[]) => void;
  onTelemetryUpdate: (telemetry: SceneTelemetrySnapshot) => void;
}

export class UniverseScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private callbacks: UniverseSceneCallbacks;

  // Datasets
  private exoplanets: ExoplanetRecord[] = [];
  private stars: StarRecord[] = [];
  private constellations: ConstellationRecord[] = [];
  private compiledSatellites: CompiledSatellite[] = [];
  private deepSpace: DeepSpaceBundle | null = null;
  private catalogById: Map<string, UnifiedCelestialObject> = new Map();

  // Floating-origin 64-bit state (in Light-Years)
  private focusObjectId: string = 'earth';
  private focusPosLy: [number, number, number] = [0, 0, 0];
  private flyAnim: {
    active: boolean;
    startPosLy: [number, number, number];
    targetId: string;
    startRadius: number;
    endRadius: number;
    progress: number;
  } | null = null;

  // Route measurement ("Google Maps for the Universe")
  private routeOriginId: string = 'earth';
  private selectedObjectId: string | null = 'earth';

  // Time & Helical Solar System Motion state
  private playing: boolean = true;
  private timeScale: number = 1; // 1 = real-time (1 sec / sec)
  private simTimeMs: number = Date.now();
  private realElapsedSec: number = 0;
  private simElapsedSec: number = 0;
  private helicalDisplacementSec: number = 0;

  // Live dynamic position caches (in Light-Years)
  private livePositionsLy: Map<string, [number, number, number]> = new Map();

  // Scene Groups
  private heliocentricMacroGroup = new THREE.Group(); // Stars, Exoplanets, Constellations, Milky Way, Cosmic Web
  private solarSystemGroup = new THREE.Group();
  private satelliteGroup = new THREE.Group();
  private landmarkGroup = new THREE.Group();
  private visitedExoSystemGroup = new THREE.Group();
  private helicalGroup = new THREE.Group();
  private routeGroup = new THREE.Group();

  // Specific Meshes & Materials
  private solarMeshes: Map<string, THREE.Object3D> = new Map();
  private solarOrbitLines: Map<string, THREE.Line> = new Map();
  private sunHabitableZoneMesh: THREE.Mesh | null = null;
  private starPoints: THREE.Points | null = null;
  private starHzGroup = new THREE.Group();
  private exoplanetPoints: THREE.Points | null = null;
  private satellitePoints: THREE.Points | null = null;
  private selectedSatOrbitLine: THREE.Line | null = null;
  private constellationLinesMesh: THREE.LineSegments | null = null;
  private zodiacLinesMesh: THREE.LineSegments | null = null;
  private zodiacEclipticRing: THREE.Line | null = null;
  private milkyWayPoints: THREE.Points | null = null;
  private cosmicWebPoints: THREE.Points | null = null;
  private cosmicWebLines: THREE.LineSegments | null = null;
  private cmbSphereMesh: THREE.Mesh | null = null;
  private landmarkMeshes: Map<string, THREE.Object3D> = new Map();
  private routeLine: THREE.Line | null = null;

  // Helical trails & real-time velocity lattice
  private helicalTrails: Map<string, { pointsLy: [number, number, number][]; line: THREE.Line }> = new Map();
  private velocityGridPoints: THREE.Points | null = null;
  private velocityArrowsGroup = new THREE.Group();
  private lastTrailSampleSimMs: number = 0;

  // Shader uniforms needing uTime updates
  private animatedMaterials: Set<THREE.ShaderMaterial> = new Set();
  private textureLoader = new THREE.TextureLoader();

  // State flags
  private layers: LayerVisibility;
  private filters: UniverseFilters;
  private matchedCounts = { exoplanets: 0, stars: 0, satellites: 0 };

  // Loop & Perf
  private rafId: number = 0;
  private lastFrameMs: number = performance.now();
  private lastHudBroadcastMs: number = 0;
  private frameCounter: number = 0;
  private fpsAccumMs: number = 0;
  private currentFps: number = 60;
  private disposed: boolean = false;

  // Pointer click vs drag detection
  private pointerDownPos = { x: 0, y: 0, time: 0 };
  private raycaster = new THREE.Raycaster();

  constructor(
    container: HTMLElement,
    initialLayers: LayerVisibility,
    initialFilters: UniverseFilters,
    callbacks: UniverseSceneCallbacks
  ) {
    this.container = container;
    this.layers = { ...initialLayers };
    this.filters = { ...initialFilters };
    this.callbacks = callbacks;

    this.textureLoader.setCrossOrigin('anonymous');

    // WebGL2 Renderer with Logarithmic Depth Buffer across 22 orders of magnitude!
    this.renderer = new THREE.WebGLRenderer({
      antialias: window.innerWidth > 768,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#02050d');

    // Camera spans from 10 km (0.01 units) out to >1,000 Billion Light-Years (1e22 units)!
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.01,
      1e22
    );
    // Start overlooking 3D Earth + Live Orbital Satellites + Moon + Constellation Sky!
    this.camera.position.set(16, 9, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.zoomSpeed = 1.35;
    this.controls.rotateSpeed = 0.7;
    this.controls.minDistance = 8.2; // Just above Earth cloud tops (8,200 km from center)
    this.controls.maxDistance = 1.2e21; // Outside the 46.5-Billion-ly Observable Universe CMB sphere!

    // Scene lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.28);
    this.scene.add(ambient);

    this.scene.add(this.heliocentricMacroGroup);
    this.scene.add(this.solarSystemGroup);
    this.scene.add(this.satelliteGroup);
    this.scene.add(this.landmarkGroup);
    this.scene.add(this.visitedExoSystemGroup);
    this.scene.add(this.helicalGroup);
    this.scene.add(this.routeGroup);
    this.heliocentricMacroGroup.add(this.starHzGroup);

    this.bindEvents();
    this.animate();
  }

  private bindEvents() {
    const dom = this.renderer.domElement;
    const onResize = () => {
      if (this.disposed) return;
      const w = this.container.clientWidth;
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onPointerDown = (e: PointerEvent) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    };
    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      const dt = performance.now() - this.pointerDownPos.time;
      if (Math.hypot(dx, dy) < 7 && dt < 450) {
        this.handleCanvasClick(e.clientX, e.clientY);
      }
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);

    // Store cleanup reference
    this.cleanupListeners = () => {
      window.removeEventListener('resize', onResize);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
    };
  }

  private cleanupListeners: () => void = () => {};

  public loadDatasets(params: {
    exoplanets: ExoplanetRecord[];
    stars: StarRecord[];
    constellations: ConstellationRecord[];
    satellites: SatelliteRecord[];
    deepSpace: DeepSpaceBundle;
    catalogById: Map<string, UnifiedCelestialObject>;
  }) {
    this.exoplanets = params.exoplanets;
    this.stars = params.stars;
    this.constellations = params.constellations;
    this.compiledSatellites = compileSatellites(params.satellites);
    this.deepSpace = params.deepSpace;
    this.catalogById = params.catalogById;

    this.buildSolarSystem();
    this.buildSatellitesLayer();
    this.buildStarsLayer();
    this.buildExoplanetsLayer();
    this.buildConstellationsAndZodiac();
    this.buildDeepSpaceAndCosmicWeb();
    this.buildHelicalMotionVisuals();
    this.buildRouteLine();

    // Initialize live positions so Earth starts centered cleanly
    this.updateDynamicPositions(new Date(this.simTimeMs));
    const earthPos = this.livePositionsLy.get('earth') || [0, 0, 0];
    this.focusPosLy = [...earthPos];

    this.applyLayers();
    this.applyFilters();
  }

  /**
   * 1. Build 3D Solar System (Sun, 8 Planets, Moon, Pluto, Rings, Habitable Zone & Elliptical Orbits)
   */
  private buildSolarSystem() {
    this.solarSystemGroup.clear();
    this.solarMeshes.clear();
    this.solarOrbitLines.clear();
    if (!this.deepSpace) return;

    const now = new Date(this.simTimeMs);

    for (const body of this.deepSpace.solarSystem) {
      const holder = new THREE.Group();
      holder.userData = { objectId: body.id };

      if (body.id === 'sun') {
        const mat = createStarSurfaceMaterial('#ffbe55');
        this.animatedMaterials.add(mat);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), mat);
        mesh.userData = { objectId: body.id };
        holder.add(mesh);

        // Soft additive solar corona glow sprite
        const glowGeo = new THREE.PlaneGeometry(4.8, 4.8);
        const glowMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec2 vUv;
            void main() {
              vUv = uv;
              // Billboard in view space
              vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
              float scale = length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]));
              mvCenter.xy += position.xy * scale;
              gl_Position = projectionMatrix * mvCenter;
              #include <logdepthbuf_vertex>
            }
          `,
          fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            varying vec2 vUv;
            void main() {
              #include <logdepthbuf_fragment>
              float d = length(vUv - 0.5) * 2.0;
              if (d > 1.0) discard;
              float g = pow(1.0 - d, 3.0) * 0.65;
              gl_FragColor = vec4(1.0, 0.76, 0.32, g);
            }
          `,
        });
        holder.add(new THREE.Mesh(glowGeo, glowMat));

        // Sun Circumstellar Habitable Zone Ring (0.95 AU -> 1.67 AU)
        const outerUnits = 1.67 * RENDER_UNITS_PER_AU * 2;
        const hzGeo = new THREE.PlaneGeometry(outerUnits, outerUnits);
        const hzMat = createHabitableZoneMaterial();
        hzMat.uniforms.uInnerRatio.value = 0.95 / 1.67;
        this.animatedMaterials.add(hzMat);
        this.sunHabitableZoneMesh = new THREE.Mesh(hzGeo, hzMat);
        // Align roughly with ecliptic (23.44° obliquity around X axis in J2000 Equatorial)
        this.sunHabitableZoneMesh.rotation.x = Math.PI / 2 - (23.439 * Math.PI) / 180;
        this.solarSystemGroup.add(this.sunHabitableZoneMesh);
      } else {
        const mat = createProceduralPlanetMaterial({
          planetType: body.planetType || 'Rocky',
          tempK: body.tempK,
          inHabitableZone: body.id === 'earth',
          baseColor: body.color,
          seed: body.semiMajorAxisAu * 13.7 + body.radiusKm * 0.001,
        });
        this.animatedMaterials.add(mat);
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 44, 44), mat);
        sphere.userData = { objectId: body.id, isPlanetSphere: true };
        holder.add(sphere);

        // Planetary Rings for Saturn & Uranus
        if (body.hasRings) {
          const innerR = body.id === 'saturn' ? 1.35 : 1.45;
          const outerR = body.id === 'saturn' ? 2.35 : 1.85;
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 72);
          const ringMat = new THREE.MeshBasicMaterial({
            color: body.id === 'saturn' ? '#e5cf9b' : '#7dd3fc',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: body.id === 'saturn' ? 0.68 : 0.28,
            depthWrite: false,
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = body.id === 'uranus' ? 0.15 : Math.PI / 2.3;
          holder.add(ringMesh);
        }

        // Elliptical 3D Orbit Line
        const ringPtsLy = computeOrbitRingLy(body, now);
        if (ringPtsLy.length > 2) {
          const positions = new Float32Array(ringPtsLy.length * 3);
          for (let i = 0; i < ringPtsLy.length; i++) {
            positions[i * 3] = ringPtsLy[i][0] * RENDER_UNITS_PER_LY;
            positions[i * 3 + 1] = ringPtsLy[i][1] * RENDER_UNITS_PER_LY;
            positions[i * 3 + 2] = ringPtsLy[i][2] * RENDER_UNITS_PER_LY;
          }
          const orbitGeo = new THREE.BufferGeometry();
          orbitGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const orbitMat = new THREE.LineBasicMaterial({
            color: body.color,
            transparent: true,
            opacity: body.id === 'earth' ? 0.5 : 0.28,
          });
          const orbitLine = new THREE.Line(orbitGeo, orbitMat);
          orbitLine.frustumCulled = false;
          this.solarOrbitLines.set(body.id, orbitLine);
          this.solarSystemGroup.add(orbitLine);
        }
      }

      this.solarMeshes.set(body.id, holder);
      this.solarSystemGroup.add(holder);
    }
  }

  /**
   * 2. Build Real-Time SGP4 Earth Satellites Layer (ISS, Tiangong, Hubble, GPS, Starlink, Weather)
   */
  private buildSatellitesLayer() {
    this.satelliteGroup.clear();
    const count = this.compiledSatellites.length;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const alphas = new Float32Array(count);
    const highlights = new Float32Array(count);

    const tmpColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const sat = this.compiledSatellites[i].record;
      const isStation = sat.category === 'Space Station';
      const isTelescope = sat.category.includes('Telescope');
      tmpColor.set(isStation ? '#fde047' : isTelescope ? '#c084fc' : '#38bdf8');
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
      scales[i] = isStation ? 2.4 : isTelescope ? 1.8 : 1.0;
      alphas[i] = 0.92;
      highlights[i] = isStation ? 1.0 : 0.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aHighlight', new THREE.BufferAttribute(highlights, 1));

    const mat = createCosmicPointsMaterial({
      baseSizePx: 6.5,
      maxSizePx: 22,
      diffractionSpikes: false,
    });
    this.satellitePoints = new THREE.Points(geo, mat);
    this.satellitePoints.frustumCulled = false;
    this.satelliteGroup.add(this.satellitePoints);
  }

  /**
   * 3. Build 6,835 Real 3D HYG Stars + Circumstellar Habitable Zone Rings for Bright/Nearby Stars
   */
  private buildStarsLayer() {
    if (this.starPoints) {
      this.heliocentricMacroGroup.remove(this.starPoints);
    }
    this.starHzGroup.clear();

    const count = this.stars.length;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const alphas = new Float32Array(count);
    const highlights = new Float32Array(count);

    const tmpColor = new THREE.Color();
    const sharedHzMat = createHabitableZoneMaterial();
    this.animatedMaterials.add(sharedHzMat);

    for (let i = 0; i < count; i++) {
      const s = this.stars[i];
      positions[i * 3] = s.posLy[0] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 1] = s.posLy[1] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 2] = s.posLy[2] * RENDER_UNITS_PER_LY;

      tmpColor.set(starColorFromTempOrClass(s.teff, s.specClass));
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;

      // Brighter stars (smaller/negative mag) get larger crisp diffraction points
      scales[i] = Math.max(0.55, Math.min(3.6, (6.5 - s.mag) * 0.48));
      alphas[i] = Math.max(0.35, Math.min(1.0, (7.0 - s.mag) * 0.22));
      highlights[i] = 0.0;

      this.livePositionsLy.set(s.id, s.posLy);

      // Add visual 3D Habitable Zone markers around the 140 nearest/named stars so toggling Habitable Zones
      // visibly illuminates Goldilocks zones across our entire Stellar Neighborhood AND at true AU scale!
      if ((s.distLy < 42 || s.proper) && this.starHzGroup.children.length < 160) {
        // Exaggerate softly at interstellar overview OR true AU when zoomed in (handled via scale update, base = 1.0)
        const outerAu = Math.max(0.05, Math.min(40, s.hzOuterAu));
        const hzDiameterUnits = outerAu * 2 * RENDER_UNITS_PER_AU;
        const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sharedHzMat);
        ringMesh.position.set(
          s.posLy[0] * RENDER_UNITS_PER_LY,
          s.posLy[1] * RENDER_UNITS_PER_LY,
          s.posLy[2] * RENDER_UNITS_PER_LY
        );
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.userData = { baseDiameterUnits: hzDiameterUnits, starPosLy: s.posLy };
        ringMesh.frustumCulled = false;
        this.starHzGroup.add(ringMesh);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aHighlight', new THREE.BufferAttribute(highlights, 1));

    const mat = createCosmicPointsMaterial({
      baseSizePx: 5.2,
      maxSizePx: 28,
      diffractionSpikes: true,
    });
    this.starPoints = new THREE.Points(geo, mat);
    this.starPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.starPoints);
  }

  /**
   * 4. Build 6,423 Real NASA Confirmed Exoplanets Layer
   */
  private buildExoplanetsLayer() {
    if (this.exoplanetPoints) {
      this.heliocentricMacroGroup.remove(this.exoplanetPoints);
    }

    const count = this.exoplanets.length;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const alphas = new Float32Array(count);
    const highlights = new Float32Array(count);

    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = this.exoplanets[i];
      positions[i * 3] = p.posLy[0] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 1] = p.posLy[1] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 2] = p.posLy[2] * RENDER_UNITS_PER_LY;

      tmpColor.set(exoplanetColorFromType(p.planetType, p.inHabitableZone));
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;

      scales[i] = p.inHabitableZone ? 1.65 : p.isRecent ? 1.45 : 1.0;
      alphas[i] = 0.78;
      highlights[i] = p.inHabitableZone ? 1.0 : 0.0;

      this.livePositionsLy.set(p.id, p.posLy);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aHighlight', new THREE.BufferAttribute(highlights, 1));

    const mat = createCosmicPointsMaterial({
      baseSizePx: 5.5,
      maxSizePx: 24,
      diffractionSpikes: false,
    });
    this.exoplanetPoints = new THREE.Points(geo, mat);
    this.exoplanetPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.exoplanetPoints);
  }

  /**
   * 5. Build 88 IAU 3D Constellations & 12 Zodiac Star Sign Overlays
   */
  private buildConstellationsAndZodiac() {
    if (this.constellationLinesMesh) this.heliocentricMacroGroup.remove(this.constellationLinesMesh);
    if (this.zodiacLinesMesh) this.heliocentricMacroGroup.remove(this.zodiacLinesMesh);
    if (this.zodiacEclipticRing) this.heliocentricMacroGroup.remove(this.zodiacEclipticRing);

    const regularVerts: number[] = [];
    const zodiacVerts: number[] = [];

    for (const c of this.constellations) {
      this.livePositionsLy.set(`const-${c.id}`, c.labelPosLy);
      const targetArr = c.isZodiac ? zodiacVerts : regularVerts;
      for (const poly of c.segments3D) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i];
          const b = poly[i + 1];
          targetArr.push(
            a[0] * RENDER_UNITS_PER_LY,
            a[1] * RENDER_UNITS_PER_LY,
            a[2] * RENDER_UNITS_PER_LY,
            b[0] * RENDER_UNITS_PER_LY,
            b[1] * RENDER_UNITS_PER_LY,
            b[2] * RENDER_UNITS_PER_LY
          );
        }
      }
    }

    if (regularVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(regularVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.34,
      });
      this.constellationLinesMesh = new THREE.LineSegments(geo, mat);
      this.constellationLinesMesh.frustumCulled = false;
      this.heliocentricMacroGroup.add(this.constellationLinesMesh);
    }

    if (zodiacVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(zodiacVerts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: '#fbbf24',
        transparent: true,
        opacity: 0.72,
      });
      this.zodiacLinesMesh = new THREE.LineSegments(geo, mat);
      this.zodiacLinesMesh.frustumCulled = false;
      this.heliocentricMacroGroup.add(this.zodiacLinesMesh);
    }

    // 3D Ecliptic Zodiac Belt Ring at 180 ly radius tilted 23.439° to Celestial Equator
    const eclipticPts: THREE.Vector3[] = [];
    const rUnits = 180 * RENDER_UNITS_PER_LY;
    const obliq = (23.43928 * Math.PI) / 180;
    for (let i = 0; i <= 180; i++) {
      const lon = (i / 180) * Math.PI * 2;
      const xEq = Math.cos(lon);
      const yEq = Math.sin(lon) * Math.cos(obliq);
      const zEq = Math.sin(lon) * Math.sin(obliq);
      eclipticPts.push(new THREE.Vector3(xEq * rUnits, zEq * rUnits, -yEq * rUnits));
    }
    const eclGeo = new THREE.BufferGeometry().setFromPoints(eclipticPts);
    const eclMat = new THREE.LineDashedMaterial({
      color: '#f59e0b',
      transparent: true,
      opacity: 0.45,
      dashSize: 5 * RENDER_UNITS_PER_LY,
      gapSize: 3 * RENDER_UNITS_PER_LY,
    });
    this.zodiacEclipticRing = new THREE.Line(eclGeo, eclMat);
    this.zodiacEclipticRing.computeLineDistances();
    this.zodiacEclipticRing.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.zodiacEclipticRing);
  }

  /**
   * 6. Build 2.5D Telescope Image Models (Nebulae, Galaxies, Black Holes),
   *    3D Milky Way Spiral Galaxy Disk, 3D Cosmic Web Filaments & 46.5-Gly CMB Horizon Sphere!
   */
  private buildDeepSpaceAndCosmicWeb() {
    this.landmarkGroup.clear();
    this.landmarkMeshes.clear();
    if (!this.deepSpace) return;

    const allDeep: DeepSpaceRecord[] = [...this.deepSpace.landmarks, ...this.deepSpace.catalogDsos];

    for (const d of allDeep) {
      if (d.id === 'jwst') continue; // Updated dynamically near Earth L2
      this.livePositionsLy.set(d.id, d.posLy);

      if (d.id === 'cmb-horizon') continue; // Rendered as full-sky 46.5 Gly Observable Horizon Shell below

      // Landmarks with real telescope captures render as Clever 2.5D Volumetric Depth-Parallax 3D Models!
      if (d.renderAs25D && d.heroImage) {
        const planeGeo = new THREE.PlaneGeometry(1, 1, 36, 36);
        const { primaryUrl, fallbackUrl } = resolveWebGLTextureUrls(d.heroImage);
        const tex = this.textureLoader.load(
          primaryUrl,
          undefined,
          undefined,
          () => {
            this.textureLoader.load(fallbackUrl, (t2) => {
              t2.colorSpace = THREE.SRGBColorSpace;
              mat.uniforms.uMap.value = t2;
            });
          }
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = createTelescope25DMaterial({
          texture: tex,
          tintColor: d.color,
          spherical: d.category === 'black-hole',
          depthStrength: d.category === 'galaxy' ? 0.16 : 0.28,
        });
        this.animatedMaterials.add(mat);

        const mesh = new THREE.Mesh(planeGeo, mat);
        mesh.userData = { objectId: d.id, baseSizeLy: Math.max(2.0, d.sizeLy * 1.4), posLy: d.posLy };
        mesh.frustumCulled = false;
        this.landmarkMeshes.set(d.id, mesh);
        this.landmarkGroup.add(mesh);
      } else {
        // Glowing volumetric beacon for spacecraft / cosmic voids / catalog DSOs
        const spriteGeo = new THREE.SphereGeometry(1, 20, 20);
        const spriteMat = new THREE.MeshBasicMaterial({
          color: d.color,
          transparent: true,
          opacity: d.category === 'cosmic-structure' ? 0.22 : 0.85,
          wireframe: d.category === 'cosmic-structure',
        });
        const mesh = new THREE.Mesh(spriteGeo, spriteMat);
        mesh.userData = { objectId: d.id, baseSizeLy: Math.max(0.05, d.sizeLy * 0.5), posLy: d.posLy };
        mesh.frustumCulled = false;
        this.landmarkMeshes.set(d.id, mesh);
        this.landmarkGroup.add(mesh);
      }
    }

    // Build 3D Milky Way Barred Spiral Galaxy Disk anchored around Sagittarius A* (26,673 ly away!)
    const sgrA = this.deepSpace.landmarks.find((l) => l.id === 'sagittarius-a-star');
    const galCenterLy = sgrA ? sgrA.posLy : [-1300, -12900, 23300];
    const mwCount = 5500;
    const mwPos = new Float32Array(mwCount * 3);
    const mwCol = new Float32Array(mwCount * 3);
    const mwScale = new Float32Array(mwCount);
    const mwAlpha = new Float32Array(mwCount);
    const mwHigh = new Float32Array(mwCount);
    const cCore = new THREE.Color('#fde68a');
    const cArm = new THREE.Color('#7dd3fc');
    const cDust = new THREE.Color('#c084fc');

    // Galactic plane basis vectors (Galactic North Pole RA=192.86°, Dec=+27.13°)
    const gNorth = new THREE.Vector3(
      Math.cos(0.4735) * Math.cos(3.366),
      Math.sin(0.4735),
      -Math.cos(0.4735) * Math.sin(3.366)
    ).normalize();
    const gToSun = new THREE.Vector3(-galCenterLy[0], -galCenterLy[1], -galCenterLy[2]).normalize();
    const gTangent = new THREE.Vector3().crossVectors(gNorth, gToSun).normalize();

    for (let i = 0; i < mwCount; i++) {
      const arm = i % 4;
      const u = Math.pow(Math.random(), 0.72);
      const rLy = 1200 + u * 54000;
      const theta = (arm * Math.PI) / 2 + Math.log(1 + rLy / 3800) * 2.55 + (Math.random() - 0.5) * (0.55 + u * 0.4);
      const thicknessLy = (Math.random() - 0.5) * (rLy < 7000 ? 3200 : 1400);

      const px = galCenterLy[0] + (Math.cos(theta) * gToSun.x + Math.sin(theta) * gTangent.x) * rLy + gNorth.x * thicknessLy;
      const py = galCenterLy[1] + (Math.cos(theta) * gToSun.y + Math.sin(theta) * gTangent.y) * rLy + gNorth.y * thicknessLy;
      const pz = galCenterLy[2] + (Math.cos(theta) * gToSun.z + Math.sin(theta) * gTangent.z) * rLy + gNorth.z * thicknessLy;

      mwPos[i * 3] = px * RENDER_UNITS_PER_LY;
      mwPos[i * 3 + 1] = py * RENDER_UNITS_PER_LY;
      mwPos[i * 3 + 2] = pz * RENDER_UNITS_PER_LY;

      const col = rLy < 9000 ? cCore : i % 5 === 0 ? cDust : cArm;
      mwCol[i * 3] = col.r;
      mwCol[i * 3 + 1] = col.g;
      mwCol[i * 3 + 2] = col.b;
      mwScale[i] = rLy < 8000 ? 1.8 : 1.1;
      mwAlpha[i] = 0.26;
      mwHigh[i] = 0;
    }

    const mwGeo = new THREE.BufferGeometry();
    mwGeo.setAttribute('position', new THREE.BufferAttribute(mwPos, 3));
    mwGeo.setAttribute('aColor', new THREE.BufferAttribute(mwCol, 3));
    mwGeo.setAttribute('aScale', new THREE.BufferAttribute(mwScale, 1));
    mwGeo.setAttribute('aAlpha', new THREE.BufferAttribute(mwAlpha, 1));
    mwGeo.setAttribute('aHighlight', new THREE.BufferAttribute(mwHigh, 1));
    this.milkyWayPoints = new THREE.Points(
      mwGeo,
      createCosmicPointsMaterial({ baseSizePx: 7.0, maxSizePx: 22, opacity: 0.7 })
    );
    this.milkyWayPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.milkyWayPoints);

    // Build 3D Cosmic Web Supercluster Filaments (10 Million ly -> 44 Billion ly)
    const nodesCount = 260;
    const webNodes: THREE.Vector3[] = [];
    for (let i = 0; i < nodesCount; i++) {
      // Logarithmic radial distribution spanning Local Superclusters -> Observable Horizon
      const logMin = Math.log10(8e6);
      const logMax = Math.log10(4.1e10);
      const rLy = Math.pow(10, logMin + (i / nodesCount) * (logMax - logMin));
      const phi = Math.acos(1 - 2 * ((i * 0.61803398875) % 1));
      const theta = i * 2.39996323;
      webNodes.push(
        new THREE.Vector3(
          rLy * Math.sin(phi) * Math.cos(theta),
          rLy * Math.cos(phi),
          rLy * Math.sin(phi) * Math.sin(theta)
        )
      );
    }

    const filamentVerts: number[] = [];
    const galFieldPos: number[] = [];
    const galFieldCol: number[] = [];
    const galFieldScale: number[] = [];
    const galFieldAlpha: number[] = [];
    const galFieldHigh: number[] = [];
    const cFil1 = new THREE.Color('#818cf8');
    const cFil2 = new THREE.Color('#38bdf8');
    const cFil3 = new THREE.Color('#f472b6');

    for (let i = 0; i < nodesCount; i++) {
      const a = webNodes[i];
      // Connect to 2 nearest scale-compatible cosmic web nodes to form realistic Voronoi-like filaments & voids
      const neighbors = webNodes
        .map((b, idx) => ({ idx, b, d: a.distanceTo(b) }))
        .filter((n) => n.idx > i && n.d < a.length() * 0.75)
        .sort((x, y) => x.d - y.d)
        .slice(0, 2);

      for (const nb of neighbors) {
        filamentVerts.push(
          a.x * RENDER_UNITS_PER_LY,
          a.y * RENDER_UNITS_PER_LY,
          a.z * RENDER_UNITS_PER_LY,
          nb.b.x * RENDER_UNITS_PER_LY,
          nb.b.y * RENDER_UNITS_PER_LY,
          nb.b.z * RENDER_UNITS_PER_LY
        );

        // Populate filament bridge with galaxy clusters
        for (let s = 0; s < 10; s++) {
          const t = Math.random();
          const spread = a.length() * 0.035;
          const gx = THREE.MathUtils.lerp(a.x, nb.b.x, t) + (Math.random() - 0.5) * spread;
          const gy = THREE.MathUtils.lerp(a.y, nb.b.y, t) + (Math.random() - 0.5) * spread;
          const gz = THREE.MathUtils.lerp(a.z, nb.b.z, t) + (Math.random() - 0.5) * spread;
          galFieldPos.push(gx * RENDER_UNITS_PER_LY, gy * RENDER_UNITS_PER_LY, gz * RENDER_UNITS_PER_LY);
          const col = s % 3 === 0 ? cFil3 : s % 2 === 0 ? cFil2 : cFil1;
          galFieldCol.push(col.r, col.g, col.b);
          galFieldScale.push(1.15);
          galFieldAlpha.push(0.42);
          galFieldHigh.push(0);
        }
      }
    }

    const filGeo = new THREE.BufferGeometry();
    filGeo.setAttribute('position', new THREE.Float32BufferAttribute(filamentVerts, 3));
    this.cosmicWebLines = new THREE.LineSegments(
      filGeo,
      new THREE.LineBasicMaterial({ color: '#6366f1', transparent: true, opacity: 0.18 })
    );
    this.cosmicWebLines.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.cosmicWebLines);

    const cwGeo = new THREE.BufferGeometry();
    cwGeo.setAttribute('position', new THREE.Float32BufferAttribute(galFieldPos, 3));
    cwGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(galFieldCol, 3));
    cwGeo.setAttribute('aScale', new THREE.Float32BufferAttribute(galFieldScale, 1));
    cwGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(galFieldAlpha, 1));
    cwGeo.setAttribute('aHighlight', new THREE.Float32BufferAttribute(galFieldHigh, 1));
    this.cosmicWebPoints = new THREE.Points(
      cwGeo,
      createCosmicPointsMaterial({ baseSizePx: 5.5, maxSizePx: 18, opacity: 0.8 })
    );
    this.cosmicWebPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.cosmicWebPoints);

    // 46.5-Billion-Light-Year Cosmic Microwave Background (Observable Universe Boundary Sphere!)
    const cmbRadiusUnits = 46_500_000_000 * RENDER_UNITS_PER_LY;
    const cmbGeo = new THREE.SphereGeometry(cmbRadiusUnits, 48, 32);
    const cmbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          // Planck/WMAP-inspired acoustic anisotropy mottling
          float n = sin(vDir.x * 19.0) * cos(vDir.y * 23.0) * sin(vDir.z * 17.0) +
                    0.5 * cos(vDir.x * 43.0 + vDir.z * 37.0);
          vec3 coldSpot = vec3(0.05, 0.22, 0.58);
          vec3 warmSpot = vec3(0.85, 0.36, 0.08);
          vec3 col = mix(coldSpot, warmSpot, clamp(n * 0.5 + 0.5, 0.0, 1.0));
          float grid = smoothstep(0.985, 1.0, abs(sin(vDir.y * 24.0))) * 0.18;
          gl_FragColor = vec4(col + grid, 0.16);
        }
      `,
    });
    this.cmbSphereMesh = new THREE.Mesh(cmbGeo, cmbMat);
    this.cmbSphereMesh.userData = { objectId: 'cmb-horizon' };
    this.cmbSphereMesh.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.cmbSphereMesh);
  }

  /**
   * 7. Build Real-Time Solar System Velocity Grid & Helical Corkscrew Motion Ribbons
   */
  private buildHelicalMotionVisuals() {
    this.helicalGroup.clear();
    this.helicalTrails.clear();
    this.velocityArrowsGroup.clear();

    const trackedBodies = [
      { id: 'sun', color: '#ffbe55' },
      { id: 'mercury', color: '#b8b2a6' },
      { id: 'venus', color: '#e8c488' },
      { id: 'earth', color: '#3b82f6' },
      { id: 'mars', color: '#ef5b36' },
      { id: 'jupiter', color: '#d9a066' },
      { id: 'saturn', color: '#ebd294' },
      { id: 'uranus', color: '#7dd3fc' },
      { id: 'neptune', color: '#3b66f5' },
    ];

    for (const b of trackedBodies) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({
        color: b.color,
        transparent: true,
        opacity: b.id === 'sun' || b.id === 'earth' ? 0.9 : 0.65,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.helicalGroup.add(line);
      this.helicalTrails.set(b.id, { pointsLy: [], line });
    }

    // Real-Time Streaming Cosmic Reference Dust Lattice:
    // 500 particles around camera focus that stream past at exact 230 km/s Galactic Speed so even at 1x Real-Time
    // you can visually feel the blistering speed of our Solar System hurtling through space!
    const pCount = 500;
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const pScale = new Float32Array(pCount);
    const pAlpha = new Float32Array(pCount);
    const pHigh = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 2;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 2;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 2;
      pCol[i * 3] = 0.22;
      pCol[i * 3 + 1] = 0.88;
      pCol[i * 3 + 2] = 0.98;
      pScale[i] = 1.0;
      pAlpha[i] = 0.6;
      pHigh[i] = 0;
    }
    const vGeo = new THREE.BufferGeometry();
    vGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    vGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
    vGeo.setAttribute('aScale', new THREE.BufferAttribute(pScale, 1));
    vGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
    vGeo.setAttribute('aHighlight', new THREE.BufferAttribute(pHigh, 1));
    this.velocityGridPoints = new THREE.Points(
      vGeo,
      createCosmicPointsMaterial({ baseSizePx: 4.5, maxSizePx: 12, opacity: 0.75 })
    );
    this.velocityGridPoints.frustumCulled = false;
    this.helicalGroup.add(this.velocityGridPoints);

    // 3D Velocity Vector Arrows (Galactic Orbit 230 km/s & CMB Dipole 369.8 km/s)
    const galArrow = new THREE.ArrowHelper(
      new THREE.Vector3(...SOLAR_GALACTIC_APEX_DIR).normalize(),
      new THREE.Vector3(0, 0, 0),
      1,
      0x22d3ee,
      0.22,
      0.12
    );
    const cmbArrow = new THREE.ArrowHelper(
      new THREE.Vector3(...SOLAR_CMB_APEX_DIR).normalize(),
      new THREE.Vector3(0, 0, 0),
      1.15,
      0xfbbf24,
      0.22,
      0.12
    );
    this.velocityArrowsGroup.add(galArrow, cmbArrow);
    this.helicalGroup.add(this.velocityArrowsGroup);
  }

  /**
   * 8. Build "Google Maps for the Universe" 3D Point-to-Point Route Line
   */
  private buildRouteLine() {
    this.routeGroup.clear();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const mat = new THREE.LineDashedMaterial({
      color: '#22d3ee',
      transparent: true,
      opacity: 0.9,
      dashSize: 1,
      gapSize: 0.5,
    });
    this.routeLine = new THREE.Line(geo, mat);
    this.routeLine.frustumCulled = false;
    this.routeGroup.add(this.routeLine);
  }

  /**
   * Spawn a full 3D Exoplanet System Diorama (Host Star + Habitable Zone Ring + All Sibling Exoplanets!)
   * whenever a user inspects or flies to ANY exoplanet or host star!
   */
  private buildVisitedExoplanetSystem(targetId: string) {
    this.visitedExoSystemGroup.clear();
    const obj = this.catalogById.get(targetId);
    if (!obj || obj.category !== 'exoplanet' || !obj.raw) return;

    const exo = obj.raw as ExoplanetRecord;
    const siblings = this.exoplanets.filter((p) => p.hostStar === exo.hostStar);
    if (siblings.length === 0) return;

    const anchorPosLy = exo.posLy;
    this.visitedExoSystemGroup.userData = { anchorPosLy, hostStar: exo.hostStar, siblings };

    // 1. 3D Boiling Host Star
    const starColor = starColorFromTempOrClass(exo.starTeff, exo.starSpecClass);
    const starMat = createStarSurfaceMaterial(starColor);
    this.animatedMaterials.add(starMat);
    const starRadiusUnits = Math.max(0.12, exo.starRadiiSolar) * 696.34; // True solar radius in 1,000-km units!
    const starMesh = new THREE.Mesh(new THREE.SphereGeometry(starRadiusUnits * 3.5, 40, 40), starMat);
    this.visitedExoSystemGroup.add(starMesh);

    // 2. Circumstellar Habitable Zone Ring
    const hzOuterUnits = Math.max(0.02, exo.hzOuterAu) * RENDER_UNITS_PER_AU * 2;
    const hzMat = createHabitableZoneMaterial();
    hzMat.uniforms.uInnerRatio.value = Math.min(0.92, exo.hzInnerAu / Math.max(0.001, exo.hzOuterAu));
    this.animatedMaterials.add(hzMat);
    const hzMesh = new THREE.Mesh(new THREE.PlaneGeometry(hzOuterUnits, hzOuterUnits), hzMat);
    hzMesh.rotation.x = Math.PI / 2;
    hzMesh.visible = this.layers.habitableZones;
    hzMesh.name = 'exo-hz-ring';
    this.visitedExoSystemGroup.add(hzMesh);

    // 3. All Confirmed Sibling 3D Exoplanets in this Star System!
    siblings.forEach((sib, idx) => {
      const aAu = sib.semiMajorAxisAu || 0.04 * (idx + 1);
      const orbitRadiusUnits = aAu * RENDER_UNITS_PER_AU;

      // Orbit ring
      const orbitPts: THREE.Vector3[] = [];
      for (let s = 0; s <= 96; s++) {
        const ang = (s / 96) * Math.PI * 2;
        orbitPts.push(new THREE.Vector3(Math.cos(ang) * orbitRadiusUnits, 0, Math.sin(ang) * orbitRadiusUnits));
      }
      const orbitLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(orbitPts),
        new THREE.LineBasicMaterial({
          color: sib.id === targetId ? '#22d3ee' : '#64748b',
          transparent: true,
          opacity: sib.id === targetId ? 0.75 : 0.35,
        })
      );
      this.visitedExoSystemGroup.add(orbitLine);

      // 3D Procedural Exoplanet Sphere
      const pMat = createProceduralPlanetMaterial({
        planetType: sib.planetType,
        tempK: sib.tempK || 280,
        inHabitableZone: sib.inHabitableZone,
        baseColor: exoplanetColorFromType(sib.planetType, sib.inHabitableZone),
        seed: idx * 7.3 + sib.earthRadii,
      });
      this.animatedMaterials.add(pMat);
      // Readable planet scale inside exoplanet system so worlds are clearly inspectable alongside their star
      const pRadiusUnits = Math.max(45, sib.earthRadii * 6.371 * 28);
      const pMesh = new THREE.Mesh(new THREE.SphereGeometry(pRadiusUnits, 36, 36), pMat);
      pMesh.userData = {
        objectId: sib.id,
        orbitRadiusUnits,
        periodDays: sib.orbPeriodDays || 12 * (idx + 1),
        phaseOffset: idx * 1.7,
      };
      pMesh.name = `exo-mesh-${sib.id}`;
      this.visitedExoSystemGroup.add(pMesh);
    });
  }

  /**
   * Public Controls API
   */
  public setLayers(layers: LayerVisibility) {
    const prevHelical = this.layers.helicalMotion;
    this.layers = { ...layers };
    if (!prevHelical && layers.helicalMotion) {
      // Clear old ribbon history when freshly enabled
      this.helicalDisplacementSec = 0;
      for (const t of this.helicalTrails.values()) {
        t.pointsLy = [];
        t.line.geometry.setDrawRange(0, 0);
      }
    } else if (prevHelical && !layers.helicalMotion) {
      this.helicalDisplacementSec = 0;
    }
    this.applyLayers();
  }

  private applyLayers() {
    if (this.satellitePoints) this.satellitePoints.visible = this.layers.satellites;
    if (this.selectedSatOrbitLine) this.selectedSatOrbitLine.visible = this.layers.satellites;

    for (const line of this.solarOrbitLines.values()) {
      line.visible = this.layers.planetOrbits;
    }
    if (this.constellationLinesMesh) this.constellationLinesMesh.visible = this.layers.constellations;
    if (this.zodiacLinesMesh) {
      this.zodiacLinesMesh.visible = this.layers.zodiacSigns || this.layers.constellations;
    }
    if (this.zodiacEclipticRing) this.zodiacEclipticRing.visible = this.layers.zodiacSigns;

    if (this.sunHabitableZoneMesh) this.sunHabitableZoneMesh.visible = this.layers.habitableZones;
    this.starHzGroup.visible = this.layers.habitableZones;
    const exoHz = this.visitedExoSystemGroup.getObjectByName('exo-hz-ring');
    if (exoHz) exoHz.visible = this.layers.habitableZones;

    if (this.exoplanetPoints) this.exoplanetPoints.visible = this.layers.exoplanets;
    this.landmarkGroup.visible = this.layers.deepSpace;
    if (this.milkyWayPoints) this.milkyWayPoints.visible = this.layers.cosmicWeb;
    if (this.cosmicWebPoints) this.cosmicWebPoints.visible = this.layers.cosmicWeb;
    if (this.cosmicWebLines) this.cosmicWebLines.visible = this.layers.cosmicWeb;
    if (this.cmbSphereMesh) this.cmbSphereMesh.visible = this.layers.cosmicWeb;
    this.helicalGroup.visible = this.layers.helicalMotion;
  }

  public setFilters(filters: UniverseFilters) {
    this.filters = { ...filters };
    this.applyFilters();
  }

  private applyFilters() {
    const f = this.filters;
    const tmpCol = new THREE.Color();

    // 1. Filter / Highlight / Color-Group 6,423 Exoplanets
    if (this.exoplanetPoints) {
      const geo = this.exoplanetPoints.geometry;
      const alphas = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
      const highlights = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      const colors = geo.getAttribute('aColor') as THREE.BufferAttribute;
      let matched = 0;

      const hasActiveExoFilter =
        f.planetTypes.length > 0 ||
        f.minEarthRadii > 0.15 ||
        f.maxEarthRadii < 24.9 ||
        f.habitableOnly ||
        f.recentDiscoveriesOnly ||
        f.discoveryFacility !== 'ALL';

      for (let i = 0; i < this.exoplanets.length; i++) {
        const p = this.exoplanets[i];
        const matchType = f.planetTypes.length === 0 || f.planetTypes.includes(p.planetType);
        const matchSize =
          p.earthRadii >= f.minEarthRadii &&
          (f.maxEarthRadii >= 25 ? true : p.earthRadii <= f.maxEarthRadii);
        const matchHz = !f.habitableOnly || p.inHabitableZone;
        const matchRecent = !f.recentDiscoveriesOnly || p.isRecent;
        const matchFacility =
          f.discoveryFacility === 'ALL' ||
          p.discFacility.toLowerCase().includes(f.discoveryFacility.toLowerCase());

        const ok = matchType && matchSize && matchHz && matchRecent && matchFacility;
        if (ok) matched++;

        if (f.actionMode === 'isolate') {
          alphas.setX(i, ok ? 0.92 : 0.0);
          highlights.setX(i, ok && hasActiveExoFilter ? 1.0 : 0.0);
        } else if (f.actionMode === 'highlight') {
          alphas.setX(i, ok ? 1.0 : 0.12);
          highlights.setX(i, ok && hasActiveExoFilter ? 1.0 : 0.0);
        } else {
          // color-group by temperature or composition
          alphas.setX(i, ok ? 0.9 : 0.08);
          highlights.setX(i, 0.0);
        }

        tmpCol.set(exoplanetColorFromType(p.planetType, p.inHabitableZone));
        colors.setXYZ(i, tmpCol.r, tmpCol.g, tmpCol.b);
      }

      alphas.needsUpdate = true;
      highlights.needsUpdate = true;
      colors.needsUpdate = true;
      this.matchedCounts.exoplanets = matched;
    }

    // 2. Filter / Highlight 6,835 Stars by Solar Radius & Spectral Class
    if (this.starPoints) {
      const geo = this.starPoints.geometry;
      const alphas = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
      const highlights = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      let matchedStars = 0;

      const hasStarFilter =
        f.minStarSolarRadii > 0.1 ||
        f.maxStarSolarRadii < 999 ||
        f.starSpectralClasses.length > 0;

      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];
        const matchRad =
          s.solarRadii >= f.minStarSolarRadii &&
          (f.maxStarSolarRadii >= 1000 ? true : s.solarRadii <= f.maxStarSolarRadii);
        const matchSpec =
          f.starSpectralClasses.length === 0 || f.starSpectralClasses.includes(s.specClass);
        const ok = matchRad && matchSpec;
        if (ok) matchedStars++;

        const baseAlpha = Math.max(0.35, Math.min(1.0, (7.0 - s.mag) * 0.22));
        if (!hasStarFilter) {
          alphas.setX(i, baseAlpha);
          highlights.setX(i, 0.0);
        } else if (f.actionMode === 'isolate') {
          alphas.setX(i, ok ? Math.max(0.75, baseAlpha) : 0.0);
          highlights.setX(i, ok ? 1.0 : 0.0);
        } else {
          alphas.setX(i, ok ? 1.0 : 0.08);
          highlights.setX(i, ok ? 1.0 : 0.0);
        }
      }
      alphas.needsUpdate = true;
      highlights.needsUpdate = true;
      this.matchedCounts.stars = matchedStars;
    }

    // 3. Filter Satellites by Category
    if (this.satellitePoints) {
      const geo = this.satellitePoints.geometry;
      const alphas = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
      const highlights = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      let matchedSats = 0;

      for (let i = 0; i < this.compiledSatellites.length; i++) {
        const sat = this.compiledSatellites[i].record;
        const ok = f.satelliteCategory === 'ALL' || sat.category === f.satelliteCategory;
        if (ok) matchedSats++;
        alphas.setX(i, ok ? 0.95 : f.actionMode === 'isolate' ? 0.0 : 0.12);
        highlights.setX(i, ok && f.satelliteCategory !== 'ALL' ? 1.0 : sat.category === 'Space Station' ? 1.0 : 0.0);
      }
      alphas.needsUpdate = true;
      highlights.needsUpdate = true;
      this.matchedCounts.satellites = matchedSats;
    }

    // 4. Filter Deep Space Landmarks
    for (const [id, mesh] of this.landmarkMeshes.entries()) {
      const obj = this.catalogById.get(id);
      if (!obj) continue;
      mesh.visible =
        f.deepSpaceCategory === 'ALL' || obj.category === f.deepSpaceCategory;
    }
  }

  public setOpticalMode(mode: OpticalMode) {
    if (mode === 'true-color') {
      this.scene.background = new THREE.Color('#02050d');
      this.renderer.toneMappingExposure = 1.12;
      this.renderer.domElement.style.filter = 'none';
    } else if (mode === 'tactical') {
      this.scene.background = new THREE.Color('#010a0f');
      this.renderer.toneMappingExposure = 1.25;
      this.renderer.domElement.style.filter = 'contrast(1.12) saturate(1.25) hue-rotate(-8deg)';
    } else if (mode === 'infrared') {
      this.scene.background = new THREE.Color('#090205');
      this.renderer.toneMappingExposure = 1.32;
      this.renderer.domElement.style.filter = 'sepia(0.55) hue-rotate(-32deg) saturate(2.1) contrast(1.18)';
    } else if (mode === 'deep-field') {
      this.scene.background = new THREE.Color('#000004');
      this.renderer.toneMappingExposure = 1.48;
      this.renderer.domElement.style.filter = 'contrast(1.22) brightness(1.12) saturate(1.35)';
    }
  }

  public setTimeControls(playing: boolean, timeScale: number) {
    this.playing = playing;
    this.timeScale = timeScale;
  }

  public resetToLiveNow() {
    this.simTimeMs = Date.now();
    this.timeScale = 1;
    this.playing = true;
    this.realElapsedSec = 0;
    this.simElapsedSec = 0;
    this.helicalDisplacementSec = 0;
    for (const t of this.helicalTrails.values()) {
      t.pointsLy = [];
      t.line.geometry.setDrawRange(0, 0);
    }
  }

  public setRouteOrigin(originId: string) {
    this.routeOriginId = originId;
  }

  public selectObject(id: string | null, flyToTarget = false) {
    this.selectedObjectId = id;

    // Build satellite orbit ring if satellite selected
    if (this.selectedSatOrbitLine) {
      this.satelliteGroup.remove(this.selectedSatOrbitLine);
      this.selectedSatOrbitLine = null;
    }

    if (id) {
      const obj = this.catalogById.get(id);
      if (obj?.category === 'satellite') {
        const found = this.compiledSatellites.find((s) => s.record.id === id);
        if (found) {
          const ptsKm = computeSatelliteOrbitTrackKm(found.satrec, new Date(this.simTimeMs));
          if (ptsKm.length > 2) {
            const verts = new Float32Array(ptsKm.length * 3);
            for (let i = 0; i < ptsKm.length; i++) {
              verts[i * 3] = ptsKm[i][0] / RENDER_KM_UNIT;
              verts[i * 3 + 1] = ptsKm[i][1] / RENDER_KM_UNIT;
              verts[i * 3 + 2] = ptsKm[i][2] / RENDER_KM_UNIT;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            this.selectedSatOrbitLine = new THREE.Line(
              geo,
              new THREE.LineBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.85 })
            );
            this.satelliteGroup.add(this.selectedSatOrbitLine);
          }
        }
      } else if (obj?.category === 'exoplanet') {
        this.buildVisitedExoplanetSystem(id);
      }
    }

    if (id && flyToTarget) {
      this.flyToObject(id);
    }
  }

  public flyToObject(id: string, customRadiusUnits?: number) {
    const obj = this.catalogById.get(id);
    if (!obj) return;

    let desiredRadius = customRadiusUnits ?? 45;
    if (!customRadiusUnits) {
      switch (obj.category) {
        case 'satellite':
          desiredRadius = 15;
          break;
        case 'planet':
        case 'moon':
        case 'dwarf-planet': {
          const body = obj.raw as SolarSystemBody;
          desiredRadius = Math.max(16, (body.radiusKm / RENDER_KM_UNIT) * 4.2);
          break;
        }
        case 'star':
          desiredRadius = id === 'sun' ? 450_000 : 2.5 * RENDER_UNITS_PER_AU;
          break;
        case 'exoplanet':
          desiredRadius = Math.max(0.08, obj.semiMajorAxisAu || 0.15) * RENDER_UNITS_PER_AU * 1.45;
          this.buildVisitedExoplanetSystem(id);
          break;
        case 'spacecraft':
          desiredRadius = id === 'jwst' ? 8_000 : 1.5 * RENDER_UNITS_PER_AU;
          break;
        case 'nebula':
        case 'cluster': {
          const ds = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(8, ds.sizeLy * 2.2) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'black-hole': {
          const bh = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(2, bh.sizeLy * 3.0) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'galaxy': {
          const gal = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(40_000, gal.sizeLy * 2.2) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'cosmic-structure': {
          const cs = obj.raw as DeepSpaceRecord;
          desiredRadius =
            id === 'cmb-horizon'
              ? 88_000_000_000 * RENDER_UNITS_PER_LY
              : Math.max(50_000_000, cs.sizeLy * 1.5) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'constellation':
          // View constellation from Earth sky or interstellar vantage!
          desiredRadius = 380 * RENDER_UNITS_PER_LY;
          break;
      }
    }

    this.flyAnim = {
      active: true,
      startPosLy: [...this.focusPosLy],
      targetId: id,
      startRadius: this.camera.position.length(),
      endRadius: desiredRadius,
      progress: 0,
    };
  }

  public jumpToScalePreset(preset: 'earth-orbit' | 'solar-system' | 'interstellar' | 'milky-way' | 'local-group' | 'observable-universe') {
    if (preset === 'earth-orbit') {
      this.flyToObject('earth', 18);
    } else if (preset === 'solar-system') {
      this.flyToObject('sun', 16 * RENDER_UNITS_PER_AU);
    } else if (preset === 'interstellar') {
      this.flyToObject('sun', 120 * RENDER_UNITS_PER_LY);
    } else if (preset === 'milky-way') {
      this.flyToObject('sagittarius-a-star', 135_000 * RENDER_UNITS_PER_LY);
    } else if (preset === 'local-group') {
      this.flyToObject('andromeda', 4_800_000 * RENDER_UNITS_PER_LY);
    } else if (preset === 'observable-universe') {
      this.flyToObject('cmb-horizon', 92_000_000_000 * RENDER_UNITS_PER_LY);
    }
  }

  public getLivePositionLy(id: string): [number, number, number] {
    return this.livePositionsLy.get(id) || this.catalogById.get(id)?.basePosLy || [0, 0, 0];
  }

  /**
   * Click / Touch Picking across 3D Spheres, 2.5D Landmarks, Satellites, Exoplanets & Stars
   */
  private handleCanvasClick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    // 1. Check 3D Meshes (Solar System spheres, Visited Exoplanets, 2.5D Telescope Landmarks)
    const meshCandidates: THREE.Object3D[] = [
      ...Array.from(this.solarMeshes.values()),
      ...this.visitedExoSystemGroup.children.filter((c) => c.userData?.objectId),
      ...Array.from(this.landmarkMeshes.values()),
    ];
    const hits = this.raycaster.intersectObjects(meshCandidates, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.objectId) {
          this.selectObject(cur.userData.objectId, false);
          this.callbacks.onSelectObject(cur.userData.objectId);
          return;
        }
        cur = cur.parent;
      }
    }

    // 2. Screen-space nearest point pick for Satellites, Exoplanets & Bright Stars (works great on Mobile & Desktop!)
    let bestId: string | null = null;
    let bestDistPx = 22; // 22px touch-friendly hit radius
    const proj = new THREE.Vector3();

    const testScreenCandidate = (worldPos: THREE.Vector3, id: string, priorityBonus = 0) => {
      proj.copy(worldPos).project(this.camera);
      if (proj.z < -1 || proj.z > 1) return;
      const sx = ((proj.x + 1) * 0.5) * rect.width + rect.left;
      const sy = ((-proj.y + 1) * 0.5) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY) - priorityBonus;
      if (d < bestDistPx) {
        bestDistPx = d;
        bestId = id;
      }
    };

    const camRadius = this.camera.position.length();

    // Check Satellites when near Earth
    if (this.layers.satellites && this.satellitePoints && camRadius < 250_000) {
      const posAttr = this.satellitePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const alphaAttr = this.satellitePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
      const satOrigin = this.satelliteGroup.position;
      for (let i = 0; i < this.compiledSatellites.length; i++) {
        if (alphaAttr.getX(i) < 0.05) continue;
        proj.set(
          satOrigin.x + posAttr.getX(i),
          satOrigin.y + posAttr.getY(i),
          satOrigin.z + posAttr.getZ(i)
        );
        testScreenCandidate(proj, this.compiledSatellites[i].record.id, 3);
      }
    }

    // Check Exoplanets
    if (this.layers.exoplanets && this.exoplanetPoints && camRadius > 5_000) {
      const alphaAttr = this.exoplanetPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
      for (let i = 0; i < this.exoplanets.length; i++) {
        if (alphaAttr.getX(i) < 0.05) continue;
        const p = this.exoplanets[i];
        proj.set(
          (p.posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
          (p.posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
          (p.posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
        );
        testScreenCandidate(proj, p.id, p.inHabitableZone ? 2 : 0);
      }
    }

    // Check Stars
    if (this.starPoints) {
      const alphaAttr = this.starPoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
      for (let i = 0; i < this.stars.length; i++) {
        if (alphaAttr.getX(i) < 0.05) continue;
        const s = this.stars[i];
        proj.set(
          (s.posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
          (s.posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
          (s.posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
        );
        testScreenCandidate(proj, s.id, s.proper ? 2 : 0);
      }
    }

    if (bestId) {
      this.selectObject(bestId, false);
      this.callbacks.onSelectObject(bestId);
    }
  }

  /**
   * Frame-by-frame Ephemeris, SGP4 Satellites, Helical Motion & Floating-Origin Update
   */
  private updateDynamicPositions(simDate: Date) {
    // 1. Solar System Galactic / Helical Offset (230 km/s along Galactic Apex when enabled!)
    let solarOffsetLy: [number, number, number] = [0, 0, 0];
    if (this.layers.helicalMotion) {
      const distLy = (SOLAR_GALACTIC_SPEED_KMS * this.helicalDisplacementSec) / KM_PER_LY;
      solarOffsetLy = [
        SOLAR_GALACTIC_APEX_DIR[0] * distLy,
        SOLAR_GALACTIC_APEX_DIR[1] * distLy,
        SOLAR_GALACTIC_APEX_DIR[2] * distLy,
      ];
    }

    const solarPosMap = computeSolarSystemPositionsLy(simDate, solarOffsetLy);
    for (const [id, posLy] of Object.entries(solarPosMap)) {
      this.livePositionsLy.set(id, posLy);
    }

    // 2. Propagate all 458 NORAD Satellites around live Earth position!
    const earthPosLy = solarPosMap.earth;
    if (this.layers.satellites && this.satellitePoints) {
      const posAttr = this.satellitePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.compiledSatellites.length; i++) {
        const comp = this.compiledSatellites[i];
        const prop = propagateSatelliteOffsetKm(comp.satrec, simDate);
        if (prop) {
          posAttr.setXYZ(
            i,
            prop.posKm[0] / RENDER_KM_UNIT,
            prop.posKm[1] / RENDER_KM_UNIT,
            prop.posKm[2] / RENDER_KM_UNIT
          );
          this.livePositionsLy.set(comp.record.id, [
            earthPosLy[0] + prop.posKm[0] / KM_PER_LY,
            earthPosLy[1] + prop.posKm[1] / KM_PER_LY,
            earthPosLy[2] + prop.posKm[2] / KM_PER_LY,
          ]);
        }
      }
      posAttr.needsUpdate = true;
    }

    // 3. Record 3D Helical Corkscrew Ribbons when Helical Motion is active
    if (this.layers.helicalMotion && Math.abs(this.simTimeMs - this.lastTrailSampleSimMs) > 60_000) {
      this.lastTrailSampleSimMs = this.simTimeMs;
      for (const [bodyId, trail] of this.helicalTrails.entries()) {
        const p = solarPosMap[bodyId];
        if (!p) continue;
        trail.pointsLy.push([p[0], p[1], p[2]]);
        if (trail.pointsLy.length > 580) trail.pointsLy.shift();
      }
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const nowMs = performance.now();
    const dtSec = Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    // FPS tracking
    this.frameCounter++;
    this.fpsAccumMs += dtSec * 1000;
    if (this.fpsAccumMs >= 600) {
      this.currentFps = Math.round((this.frameCounter * 1000) / this.fpsAccumMs);
      this.frameCounter = 0;
      this.fpsAccumMs = 0;
    }

    // Advance Universe Time
    if (this.playing) {
      const simDeltaSec = dtSec * this.timeScale;
      this.simTimeMs += simDeltaSec * 1000;
      this.realElapsedSec += dtSec;
      this.simElapsedSec += Math.abs(simDeltaSec);
      if (this.layers.helicalMotion) {
        this.helicalDisplacementSec += simDeltaSec;
      }
    }

    const simDate = new Date(this.simTimeMs);
    this.updateDynamicPositions(simDate);

    // Update Fly-To Autopilot or Lock Focus onto Moving Target (Earth, ISS, Planet, Exoplanet, Galaxy!)
    if (this.flyAnim?.active) {
      this.flyAnim.progress = Math.min(1, this.flyAnim.progress + dtSec * 1.45);
      const t = 1 - Math.pow(1 - this.flyAnim.progress, 3); // Smooth cubic ease-out
      const destLy = this.getLivePositionLy(this.flyAnim.targetId);
      this.focusPosLy = [
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[0], destLy[0], t),
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[1], destLy[1], t),
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[2], destLy[2], t),
      ];

      // Exponential zoom interpolation across arbitrary orders of magnitude!
      const logR = THREE.MathUtils.lerp(
        Math.log(Math.max(0.02, this.flyAnim.startRadius)),
        Math.log(Math.max(0.02, this.flyAnim.endRadius)),
        t
      );
      const currentDir = this.camera.position.clone().normalize();
      if (currentDir.lengthSq() < 0.1) currentDir.set(0.6, 0.35, 0.72).normalize();
      this.camera.position.copy(currentDir.multiplyScalar(Math.exp(logR)));

      if (this.flyAnim.progress >= 1) {
        this.focusObjectId = this.flyAnim.targetId;
        this.flyAnim = null;
      }
    } else {
      const lockedPos = this.getLivePositionLy(this.focusObjectId);
      this.focusPosLy = [lockedPos[0], lockedPos[1], lockedPos[2]];
    }

    this.controls.update();

    const camRadius = this.camera.position.length();
    const uTimeVal = nowMs * 0.001;
    for (const mat of this.animatedMaterials) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = uTimeVal;
    }

    // Update O(1) Floating-Origin Offset for Heliocentric Macro Group
    this.heliocentricMacroGroup.position.set(
      -this.focusPosLy[0] * RENDER_UNITS_PER_LY,
      -this.focusPosLy[1] * RENDER_UNITS_PER_LY,
      -this.focusPosLy[2] * RENDER_UNITS_PER_LY
    );

    // Update Habitable Zone rings around stars (readable halo at interstellar zoom, exact AU up close)
    if (this.layers.habitableZones) {
      for (const child of this.starHzGroup.children) {
        const baseD = child.userData.baseDiameterUnits as number;
        const readableFloor = Math.min(2.5 * RENDER_UNITS_PER_LY, camRadius * 0.032);
        const s = Math.max(baseD, readableFloor);
        child.scale.set(s, s, 1);
      }
    }

    // Update Solar System Floating-Origin Positions, Axial Spin, Sunlight Vector & Adaptive Readable Scale
    const sunPosLy = this.livePositionsLy.get('sun') || [0, 0, 0];
    const earthPosLy = this.livePositionsLy.get('earth') || [0, 0, 0];
    const earthRot = getEarthSiderealRotationRad(simDate);

    if (this.deepSpace) {
      for (const body of this.deepSpace.solarSystem) {
        const meshGroup = this.solarMeshes.get(body.id);
        const posLy = this.livePositionsLy.get(body.id);
        if (!meshGroup || !posLy) continue;

        const rx = (posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY;
        const ry = (posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY;
        const rz = (posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY;
        meshGroup.position.set(rx, ry, rz);

        // True physical radius in 1,000-km units
        const trueRadiusUnits = body.radiusKm / RENDER_KM_UNIT;
        let renderRadius = trueRadiusUnits;
        if (!this.layers.trueScaleBodies) {
          // Adaptive NASA-Eyes-style readable boost when viewing wide Solar System, smoothly converging to 1:1 up close!
          const distToCam = Math.hypot(
            this.camera.position.x - rx,
            this.camera.position.y - ry,
            this.camera.position.z - rz
          );
          const minAngularFloor =
            distToCam < 120
              ? trueRadiusUnits
              : Math.min(
                  body.id === 'sun' ? 18_000 : 8_500,
                  distToCam * (body.id === 'sun' ? 0.022 : body.id === 'moon' ? 0.005 : 0.011)
                );
          renderRadius = Math.max(trueRadiusUnits, minAngularFloor);
        }
        meshGroup.scale.setScalar(renderRadius);

        // Spin Earth accurately to Greenwich Sidereal Time + illuminate day/night from live Sun vector!
        const sphere = meshGroup.children[0] as THREE.Mesh;
        if (sphere && body.id !== 'sun') {
          sphere.rotation.y = body.id === 'earth' ? earthRot : uTimeVal * 0.08;
          const pMat = sphere.material as THREE.ShaderMaterial;
          if (pMat.uniforms?.uSunDir) {
            pMat.uniforms.uSunDir.value
              .set(sunPosLy[0] - posLy[0], sunPosLy[1] - posLy[1], sunPosLy[2] - posLy[2])
              .normalize();
          }
        }
      }

      // Position Solar System Orbit Ellipses relative to Sun (or Earth for Moon)
      for (const [bodyId, line] of this.solarOrbitLines.entries()) {
        const anchor = bodyId === 'moon' ? earthPosLy : sunPosLy;
        line.position.set(
          (anchor[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
          (anchor[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
          (anchor[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
        );
      }
      if (this.sunHabitableZoneMesh) {
        this.sunHabitableZoneMesh.position.set(
          (sunPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
          (sunPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
          (sunPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
        );
      }
    }

    // Position Satellite Swarm exactly around live Earth center
    this.satelliteGroup.position.set(
      (earthPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
      (earthPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
      (earthPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
    );

    // Position 2.5D Deep-Space Landmarks & JWST with subtle 3D parallax orientation!
    for (const [id, mesh] of this.landmarkMeshes.entries()) {
      const pLy = this.getLivePositionLy(id);
      const wx = (pLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY;
      const wy = (pLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY;
      const wz = (pLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY;
      mesh.position.set(wx, wy, wz);

      const baseSizeUnits = (mesh.userData.baseSizeLy as number) * RENDER_UNITS_PER_LY;
      const dCam = Math.hypot(
        this.camera.position.x - wx,
        this.camera.position.y - wy,
        this.camera.position.z - wz
      );
      // Keep iconic telescope objects subtly visible when scanning nearby scale, true physical size up close
      const readableMin = Math.min(baseSizeUnits * 8, dCam * 0.035);
      mesh.scale.setScalar(Math.max(baseSizeUnits, readableMin));

      // Clever 2.5D Perspective Orientation: softly slerp normal toward camera (leaving ~32° angular offset freedom!)
      // so orbiting the camera around Pillars of Creation or Andromeda triggers true 3D steep-parallax depth shift!
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(this.camera.position, mesh.position, this.camera.up)
      );
      mesh.quaternion.slerp(targetQuat, 0.045);
    }

    // Update Visited 3D Exoplanet System Diorama (if any)
    if (this.visitedExoSystemGroup.children.length > 0 && this.visitedExoSystemGroup.userData.anchorPosLy) {
      const aLy = this.visitedExoSystemGroup.userData.anchorPosLy as [number, number, number];
      this.visitedExoSystemGroup.position.set(
        (aLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
        (aLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
        (aLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
      );

      for (const child of this.visitedExoSystemGroup.children) {
        if (child.userData?.orbitRadiusUnits) {
          const rU = child.userData.orbitRadiusUnits as number;
          const periodDays = child.userData.periodDays as number;
          const phase =
            (child.userData.phaseOffset as number) +
            (this.simTimeMs / (Math.max(0.2, periodDays) * 86_400_000)) * Math.PI * 2;
          child.position.set(Math.cos(phase) * rU, 0, Math.sin(phase) * rU);
          child.rotation.y = uTimeVal * 0.25;
          const pMat = (child as THREE.Mesh).material as THREE.ShaderMaterial;
          if (pMat.uniforms?.uSunDir) {
            pMat.uniforms.uSunDir.value.copy(child.position).negate().normalize();
          }
        }
      }
    }

    // Update Helical Corkscrew Ribbons & Real-Time Streaming Velocity Grid
    if (this.layers.helicalMotion) {
      for (const trail of this.helicalTrails.values()) {
        const pts = trail.pointsLy;
        if (pts.length >= 2) {
          const attr = trail.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < pts.length; i++) {
            attr.setXYZ(
              i,
              (pts[i][0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
              (pts[i][1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
              (pts[i][2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
            );
          }
          attr.needsUpdate = true;
          trail.line.geometry.setDrawRange(0, pts.length);
        }
      }

      // Stream reference dust lattice opposite to Solar Galactic Velocity at exact physical km/s!
      if (this.velocityGridPoints) {
        const boxSpanUnits = Math.max(40, camRadius * 1.6);
        this.velocityGridPoints.scale.setScalar(boxSpanUnits);
        const posAttr = this.velocityGridPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        // Speed in normalized box units/sec = (230 km/s * timeScale) / (boxSpanUnits * 1000 km)
        const normSpeed =
          this.playing
            ? Math.min(2.8, ((SOLAR_GALACTIC_SPEED_KMS * this.timeScale) / (boxSpanUnits * RENDER_KM_UNIT)) * dtSec * 35)
            : 0;
        for (let i = 0; i < posAttr.count; i++) {
          let x = posAttr.getX(i) - SOLAR_GALACTIC_APEX_DIR[0] * normSpeed;
          let y = posAttr.getY(i) - SOLAR_GALACTIC_APEX_DIR[1] * normSpeed;
          let z = posAttr.getZ(i) - SOLAR_GALACTIC_APEX_DIR[2] * normSpeed;
          if (x < -1) x += 2; else if (x > 1) x -= 2;
          if (y < -1) y += 2; else if (y > 1) y -= 2;
          if (z < -1) z += 2; else if (z > 1) z -= 2;
          posAttr.setXYZ(i, x, y, z);
        }
        posAttr.needsUpdate = true;
      }

      this.velocityArrowsGroup.scale.setScalar(camRadius * 0.34);
    }

    // Update "Google Maps for the Universe" 3D Route Line (Origin -> Selected Target)
    const originPosLy = this.getLivePositionLy(this.routeOriginId);
    const targetPosLy = this.selectedObjectId ? this.getLivePositionLy(this.selectedObjectId) : null;
    if (this.routeLine) {
      if (targetPosLy && this.selectedObjectId !== this.routeOriginId) {
        this.routeLine.visible = true;
        const posAttr = this.routeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        const ax = (originPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY;
        const ay = (originPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY;
        const az = (originPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY;
        const bx = (targetPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY;
        const by = (targetPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY;
        const bz = (targetPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY;
        posAttr.setXYZ(0, ax, ay, az);
        posAttr.setXYZ(1, bx, by, bz);
        posAttr.needsUpdate = true;
        const lineLen = Math.hypot(bx - ax, by - ay, bz - az);
        const mat = this.routeLine.material as THREE.LineDashedMaterial;
        mat.dashSize = Math.max(0.2, lineLen * 0.03);
        mat.gapSize = Math.max(0.1, lineLen * 0.015);
        this.routeLine.computeLineDistances();
      } else {
        this.routeLine.visible = false;
      }
    }

    this.renderer.render(this.scene, this.camera);

    // Broadcast crisp HUD Projected Labels & Live Telemetry (~20 Hz for silky UI + low React overhead)
    if (nowMs - this.lastHudBroadcastMs >= 50) {
      this.lastHudBroadcastMs = nowMs;
      this.broadcastHudAndTelemetry(camRadius, originPosLy, targetPosLy);
    }
  };

  private broadcastHudAndTelemetry(
    camRadiusUnits: number,
    originPosLy: [number, number, number],
    targetPosLy: [number, number, number] | null
  ) {
    // Determine current Cosmic Scale Regime
    const camLy = camRadiusUnits / RENDER_UNITS_PER_LY;
    const camAu = camRadiusUnits / RENDER_UNITS_PER_AU;
    const camKm = camRadiusUnits * RENDER_KM_UNIT;

    let scaleLabel = 'EARTH ORBIT // LEO–GEO';
    let cameraSpanLabel = `${Math.round(camKm).toLocaleString()} km`;
    if (camKm >= 800_000 && camAu < 4.0) {
      scaleLabel = 'INNER SOLAR SYSTEM';
      cameraSpanLabel = `${camAu.toFixed(2)} AU`;
    } else if (camAu >= 4.0 && camAu < 1500) {
      scaleLabel = 'OUTER SOLAR SYSTEM & KUIPER BELT';
      cameraSpanLabel = `${camAu.toFixed(1)} AU`;
    } else if (camAu >= 1500 && camLy < 1.5) {
      scaleLabel = 'OORT CLOUD & INTERSTELLAR BOUNDARY';
      cameraSpanLabel = `${Math.round(camAu).toLocaleString()} AU`;
    } else if (camLy >= 1.5 && camLy < 3500) {
      scaleLabel = 'STELLAR NEIGHBORHOOD & EXOPLANETS';
      cameraSpanLabel = `${camLy.toFixed(1)} Light-Years`;
    } else if (camLy >= 3500 && camLy < 450_000) {
      scaleLabel = 'MILKY WAY GALAXY';
      cameraSpanLabel = `${Math.round(camLy).toLocaleString()} Light-Years`;
    } else if (camLy >= 450_000 && camLy < 40_000_000) {
      scaleLabel = 'LOCAL GROUP GALAXIES';
      cameraSpanLabel = `${(camLy / 1e6).toFixed(2)} Million ly`;
    } else if (camLy >= 40_000_000 && camLy < 2_500_000_000) {
      scaleLabel = 'LANIAKEA & SUPERCLUSTER FILAMENTS';
      cameraSpanLabel = `${(camLy / 1e6).toFixed(0)} Million ly`;
    } else if (camLy >= 2_500_000_000) {
      scaleLabel = 'OBSERVABLE UNIVERSE // CMB HORIZON';
      cameraSpanLabel = `${(camLy / 1e9).toFixed(2)} Billion ly`;
    }

    this.callbacks.onTelemetryUpdate({
      scaleLabel,
      cameraSpanLabel,
      simTimeMs: this.simTimeMs,
      realElapsedSec: this.realElapsedSec,
      simElapsedSec: this.simElapsedSec,
      earthTraveledKm: this.simElapsedSec * EARTH_ORBIT_SPEED_KMS,
      galacticTraveledKm: this.simElapsedSec * SOLAR_GALACTIC_SPEED_KMS,
      cmbTraveledKm: this.simElapsedSec * SOLAR_CMB_SPEED_KMS,
      originPosLy,
      targetPosLy,
      fps: this.currentFps,
      matchedCounts: { ...this.matchedCounts },
    });

    if (!this.layers.labels) {
      this.callbacks.onMarkersUpdate([]);
      return;
    }

    // Project curated scale-appropriate markers onto 2D viewport with overlap culling
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const markers: ProjectedHudMarker[] = [];
    const proj = new THREE.Vector3();

    const tryProject = (
      id: string,
      name: string,
      color: string,
      category: string,
      posLy: [number, number, number],
      opts?: { tag?: string; isZodiac?: boolean; isHighlighted?: boolean; force?: boolean }
    ) => {
      proj.set(
        (posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
        (posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
        (posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
      );
      proj.project(this.camera);
      if (proj.z < -1 || proj.z > 1) return;
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      if (x < 30 || x > w - 30 || y < 55 || y > h - 75) return;

      if (!opts?.force) {
        // Simple screen-space de-clutter so labels stay super clean & readable!
        for (const existing of markers) {
          if (Math.abs(existing.x - x) < 78 && Math.abs(existing.y - y) < 24) return;
        }
      }
      markers.push({
        id,
        name,
        tag: opts?.tag,
        color,
        x,
        y,
        category,
        isZodiac: opts?.isZodiac,
        isHighlighted: opts?.isHighlighted,
      });
    };

    // Always project Selected & Route Origin
    if (this.selectedObjectId) {
      const sel = this.catalogById.get(this.selectedObjectId);
      if (sel) {
        tryProject(sel.id, sel.name, '#22d3ee', sel.category, this.getLivePositionLy(sel.id), {
          tag: 'SELECTED',
          isHighlighted: true,
          force: true,
        });
      }
    }

    // Scale-aware markers
    if (camAu < 80 && this.deepSpace) {
      for (const b of this.deepSpace.solarSystem) {
        if (b.id === 'moon' && camAu > 0.08) continue;
        tryProject(b.id, b.name, b.color, b.category, this.getLivePositionLy(b.id));
      }
      // Show Space Stations & Hubble when near Earth
      if (this.layers.satellites && camKm < 95_000) {
        for (const comp of this.compiledSatellites) {
          if (
            comp.record.category === 'Space Station' ||
            comp.record.name.includes('HST') ||
            comp.record.name.includes('HUBBLE')
          ) {
            tryProject(
              comp.record.id,
              comp.record.name,
              '#fde047',
              'satellite',
              this.getLivePositionLy(comp.record.id),
              { tag: 'LIVE TLE' }
            );
          }
        }
      }
      // JWST & Voyager 1
      if (camAu > 0.004) {
        tryProject('jwst', 'JWST (L2)', '#fbbf24', 'spacecraft', this.getLivePositionLy('jwst'));
      }
      if (camAu > 12) {
        tryProject('voyager-1', 'Voyager 1 (167 AU)', '#38bdf8', 'spacecraft', this.getLivePositionLy('voyager-1'));
      }
    }

    // Zodiac Star Signs & Major Constellations
    if (this.layers.zodiacSigns && camLy < 2000) {
      for (const c of this.constellations) {
        if (!c.isZodiac || !c.zodiac) continue;
        tryProject(
          `const-${c.id}`,
          `${c.zodiac.symbol} ${c.name}`,
          '#fbbf24',
          'constellation',
          c.labelPosLy,
          { isZodiac: true }
        );
      }
    }
    if (this.layers.constellations && camLy < 1200) {
      for (const c of this.constellations) {
        if (c.isZodiac) continue;
        if (['Ori', 'UMa', 'Cas', 'Cyg', 'Cen', 'Cru', 'Lyr', 'CMa', 'And', 'Per'].includes(c.id)) {
          tryProject(`const-${c.id}`, c.name, '#60a5fa', 'constellation', c.labelPosLy);
        }
      }
    }

    // Famous Stars & Notable / Filtered Exoplanets in Interstellar Scale
    if (camLy >= 0.4 && camLy < 8_000) {
      for (const s of this.stars) {
        if (s.proper && (s.mag < 1.65 || s.distLy < 13)) {
          tryProject(s.id, s.proper, starColorFromTempOrClass(s.teff, s.specClass), 'star', s.posLy);
          if (markers.length > 36) break;
        }
      }
      if (this.layers.exoplanets) {
        for (const p of this.exoplanets) {
          if (
            (p.inHabitableZone && p.distLy < 140) ||
            (p.isRecent && p.distLy < 250) ||
            p.name.startsWith('TRAPPIST-1') ||
            p.name.startsWith('Proxima')
          ) {
            tryProject(
              p.id,
              p.name,
              p.inHabitableZone ? '#34d399' : '#38bdf8',
              'exoplanet',
              p.posLy,
              { tag: p.inHabitableZone ? 'HZ' : p.isRecent ? 'NEW' : undefined }
            );
            if (markers.length > 46) break;
          }
        }
      }
    }

    // Deep-Space Nebulae, Black Holes, Galaxies & Cosmic Structures
    if (this.layers.deepSpace && this.deepSpace) {
      for (const lm of this.deepSpace.landmarks) {
        if (lm.id === 'jwst' || lm.id === 'voyager-1') continue;
        if (lm.distLy > camLy * 65 && camLy < 500) continue;
        if (lm.distLy < camLy * 0.002 && camLy > 50_000_000) continue;
        tryProject(lm.id, lm.name, lm.color, lm.category, lm.posLy);
      }
    }

    this.callbacks.onMarkersUpdate(markers.slice(0, 42));
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.cleanupListeners();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
