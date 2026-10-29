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
  createPlanetaryRingMaterial,
  createProceduralPlanetMaterial,
  createStarSurfaceMaterial,
  createTelescope25DMaterial,
  createTexturedEarthMaterial,
  createTexturedPlanetMaterial,
} from './shaders';
import { resolveWebGLTextureUrls } from '../utils/nasaImagesClient';

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
  onTelemetryUpdate: (telemetry: SceneTelemetrySnapshot) => void;
}

const PLANET_TEXTURE_URLS: Record<string, string> = {
  mercury: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_mercury.jpg?width=512',
  venus: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_venus_atmosphere.jpg?width=512',
  earthDay: 'https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg',
  earthNight: 'https://unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg',
  earthClouds: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_clouds_1024.png',
  moon: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg',
  mars: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_mars.jpg?width=512',
  jupiter: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_jupiter.jpg?width=512',
  saturn: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_saturn.jpg?width=512',
  uranus: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_uranus.jpg?width=512',
  neptune: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_neptune.jpg?width=512',
  milkyWayPanorama: 'https://commons.wikimedia.org/wiki/Special:FilePath/Solarsystemscope_texture_2k_stars_milky_way.jpg?width=1024',
};

const MAX_DOM_MARKERS = 24;

interface DomMarkerSlot {
  el: HTMLButtonElement;
  dot: HTMLSpanElement;
  label: HTMLSpanElement;
  tag: HTMLSpanElement;
  boundId: string;
  visible: boolean;
}

export class UniverseScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private callbacks: UniverseSceneCallbacks;

  // Zero-React-Lag Direct DOM Marker Overlay Pool (NO backdrop-filter on moving elements!)
  private markerLayerEl: HTMLDivElement;
  private markerPool: DomMarkerSlot[] = [];

  // Datasets & Pre-Filtered Label Candidates (zero 13k-item array scans per frame!)
  private exoplanets: ExoplanetRecord[] = [];
  private stars: StarRecord[] = [];
  private constellations: ConstellationRecord[] = [];
  private compiledSatellites: CompiledSatellite[] = [];
  private deepSpace: DeepSpaceBundle | null = null;
  private catalogById: Map<string, UnifiedCelestialObject> = new Map();

  private labelSatellites: CompiledSatellite[] = [];
  private labelStars: StarRecord[] = [];
  private labelExoplanets: ExoplanetRecord[] = [];
  private hasActiveExoFilter: boolean = false;

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

  private routeOriginId: string = 'earth';
  private selectedObjectId: string | null = null;

  // Time & Helical Solar System Motion state
  private playing: boolean = true;
  private timeScale: number = 1;
  private simTimeMs: number = Date.now();
  private realElapsedSec: number = 0;
  private simElapsedSec: number = 0;
  private helicalDisplacementSec: number = 0;
  private cachedEarthRotRad: number = 0;

  private livePositionsLy: Map<string, [number, number, number]> = new Map();

  // Scene Groups
  private skyPanoramaMesh: THREE.Mesh | null = null;
  private heliocentricMacroGroup = new THREE.Group();
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
  private pendingLandmarkTextures: { mat: THREE.ShaderMaterial; heroUrl: string }[] = [];
  private deepSpaceTexturesLoaded: boolean = false;
  private routeLine: THREE.Line | null = null;

  private helicalTrails: Map<string, { pointsLy: [number, number, number][]; line: THREE.Line }> = new Map();
  private velocityGridPoints: THREE.Points | null = null;
  private velocityArrowsGroup = new THREE.Group();
  private lastTrailSampleSimMs: number = 0;

  private animatedMaterials: Set<THREE.ShaderMaterial> = new Set();
  private textureLoader = new THREE.TextureLoader();

  private layers: LayerVisibility;
  private filters: UniverseFilters;
  private matchedCounts = { exoplanets: 0, stars: 0, satellites: 0 };

  // Loop & Perf
  private rafId: number = 0;
  private lastFrameMs: number = performance.now();
  private lastTelemetryBroadcastMs: number = 0;
  private lastSatPropRealMs: number = 0;
  private lastSolarEphemRealMs: number = 0;
  private frameCounter: number = 0;
  private fpsAccumMs: number = 0;
  private currentFps: number = 60;
  private disposed: boolean = false;

  // Reusable math scratchpad (zero GC allocations per frame!)
  private pointerDownPos = { x: 0, y: 0, time: 0 };
  private raycaster = new THREE.Raycaster();
  private projVec = new THREE.Vector3();
  private tmpMat4 = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();

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

    const isMobile = window.innerWidth < 768;
    // Cap DPR at 1.5 so 4K / High-DPI Windows & Mac displays stay locked at 60–144 FPS
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      stencil: false,
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#02040a');

    this.camera = new THREE.PerspectiveCamera(
      46,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.01,
      1e22
    );
    this.camera.position.set(14.5, 8.0, 19.5);

    // Smooth weighted OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.zoomSpeed = 0.95;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 7.8;
    this.controls.maxDistance = 1.2e21;

    // Immediately yield autopilot to user hand if they grab or scroll
    this.controls.addEventListener('start', () => {
      if (this.flyAnim?.active) {
        this.flyAnim = null;
      }
    });

    this.buildSkyPanorama();

    this.scene.add(this.heliocentricMacroGroup);
    this.scene.add(this.solarSystemGroup);
    this.scene.add(this.satelliteGroup);
    this.scene.add(this.landmarkGroup);
    this.scene.add(this.visitedExoSystemGroup);
    this.scene.add(this.helicalGroup);
    this.scene.add(this.routeGroup);
    this.heliocentricMacroGroup.add(this.starHzGroup);

    // Build Zero-React-Lag Direct DOM Marker Overlay
    this.markerLayerEl = document.createElement('div');
    this.markerLayerEl.className = 'pointer-events-none absolute inset-0 z-10 overflow-hidden';
    container.appendChild(this.markerLayerEl);
    this.initDomMarkerPool();

    this.bindEvents();
    this.animate();
  }

  private buildSkyPanorama() {
    const skyTex = this.textureLoader.load(PLANET_TEXTURE_URLS.milkyWayPanorama);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyGeo = new THREE.SphereGeometry(500, 32, 24);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      color: new THREE.Color('#b8d4ff'), // Cool silver-blue starlight tint (eliminates warm brown cast)
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0.22,
    });
    this.skyPanoramaMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyPanoramaMesh.renderOrder = -1000;
    this.skyPanoramaMesh.frustumCulled = false;
    this.skyPanoramaMesh.rotation.set(1.097, 0.42, 0.25);
    this.scene.add(this.skyPanoramaMesh);
  }

  private initDomMarkerPool() {
    for (let i = 0; i < MAX_DOM_MARKERS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.display = 'none';
      btn.style.willChange = 'transform';
      // IMPORTANT: No backdrop-filter on moving 3D markers — avoids 24 per-frame GPU framebuffer readbacks!
      btn.className =
        'pointer-events-auto absolute top-0 left-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border transition-colors duration-150 bg-[#050b18]/90 border-white/14 text-slate-100 hover:border-cyan-400/80 hover:bg-cyan-950/90 shadow-md cursor-pointer';

      const dot = document.createElement('span');
      dot.className = 'w-1.5 h-1.5 rounded-full shrink-0';

      const label = document.createElement('span');
      label.className = 'text-[11px] font-medium tracking-tight whitespace-nowrap';

      const tag = document.createElement('span');
      tag.className = 'text-[9px] font-mono font-semibold px-1.5 rounded-full bg-cyan-400/20 text-cyan-300';
      tag.style.display = 'none';

      btn.append(dot, label, tag);
      const slot: DomMarkerSlot = { el: btn, dot, label, tag, boundId: '', visible: false };

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!slot.boundId) return;
        const alreadySelected = this.selectedObjectId === slot.boundId;
        this.selectObject(slot.boundId, alreadySelected);
        this.callbacks.onSelectObject(slot.boundId);
      });
      btn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!slot.boundId) return;
        this.selectObject(slot.boundId, true);
        this.callbacks.onSelectObject(slot.boundId);
      });

      this.markerLayerEl.appendChild(btn);
      this.markerPool.push(slot);
    }
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

    // Pre-filter HUD label candidates once (avoids 13,700-element scans every frame!)
    this.labelSatellites = this.compiledSatellites.filter(
      (c) =>
        c.record.category === 'Space Station' ||
        c.record.name.includes('HST') ||
        c.record.name.includes('HUBBLE')
    );
    this.labelStars = this.stars
      .filter((s) => Boolean(s.proper && (s.mag < 1.6 || s.distLy < 14)))
      .slice(0, 36);
    this.labelExoplanets = this.exoplanets
      .filter(
        (p) =>
          (p.inHabitableZone && p.distLy < 110) ||
          p.name.startsWith('TRAPPIST-1') ||
          p.name.startsWith('Proxima')
      )
      .slice(0, 32);

    this.buildSolarSystem();
    this.buildSatellitesLayer();
    this.buildStarsLayer();
    this.buildExoplanetsLayer();
    this.buildConstellationsAndZodiac();
    this.buildDeepSpaceAndCosmicWeb();
    this.buildHelicalMotionVisuals();
    this.buildRouteLine();

    this.updateDynamicPositions(new Date(this.simTimeMs), true);
    const earthPos = this.livePositionsLy.get('earth') || [0, 0, 0];
    this.focusPosLy = [...earthPos];

    this.applyLayers();
    this.applyFilters();
  }

  private loadSRGBTexture(url: string): THREE.Texture {
    const tex = this.textureLoader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  private ensureDeepSpaceTexturesLoaded() {
    if (this.deepSpaceTexturesLoaded) return;
    this.deepSpaceTexturesLoaded = true;
    for (const item of this.pendingLandmarkTextures) {
      const { primaryUrl, fallbackUrl } = resolveWebGLTextureUrls(item.heroUrl);
      this.textureLoader.load(
        primaryUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          item.mat.uniforms.uMap.value = tex;
          item.mat.needsUpdate = true;
        },
        undefined,
        () => {
          this.textureLoader.load(fallbackUrl, (t2) => {
            t2.colorSpace = THREE.SRGBColorSpace;
            item.mat.uniforms.uMap.value = t2;
            item.mat.needsUpdate = true;
          });
        }
      );
    }
  }

  /**
   * 1. Build Photorealistic 3D Solar System
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
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 40), mat);
        mesh.userData = { objectId: body.id };
        holder.add(mesh);

        // Volumetric Solar Corona Sprite (100% NaN-safe)
        const glowGeo = new THREE.PlaneGeometry(5.4, 5.4);
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
              float x = max(1e-4, 1.0 - d);
              float g = x * x * x * 0.72;
              gl_FragColor = vec4(1.0, 0.72, 0.28, g);
            }
          `,
        });
        holder.add(new THREE.Mesh(glowGeo, glowMat));

        const outerUnits = 1.67 * RENDER_UNITS_PER_AU * 2;
        const hzGeo = new THREE.PlaneGeometry(outerUnits, outerUnits);
        const hzMat = createHabitableZoneMaterial();
        hzMat.uniforms.uInnerRatio.value = 0.95 / 1.67;
        this.animatedMaterials.add(hzMat);
        this.sunHabitableZoneMesh = new THREE.Mesh(hzGeo, hzMat);
        this.sunHabitableZoneMesh.rotation.x = Math.PI / 2 - (23.439 * Math.PI) / 180;
        this.solarSystemGroup.add(this.sunHabitableZoneMesh);
      } else if (body.id === 'earth') {
        const dayMap = this.loadSRGBTexture(PLANET_TEXTURE_URLS.earthDay);
        const nightMap = this.loadSRGBTexture(PLANET_TEXTURE_URLS.earthNight);
        const cloudsMap = this.textureLoader.load(PLANET_TEXTURE_URLS.earthClouds);
        const earthMat = createTexturedEarthMaterial({ dayMap, nightMap, cloudsMap });
        this.animatedMaterials.add(earthMat);

        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 56), earthMat);
        sphere.userData = { objectId: body.id, isPlanetSphere: true };
        holder.add(sphere);

        // Rayleigh Atmosphere Halo Shell (100% NaN-safe)
        const atmoMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec3 vNormalWS;
            varying vec3 vViewDirWS;
            void main() {
              vec4 worldPos = modelMatrix * vec4(position, 1.0);
              vNormalWS = mat3(modelMatrix) * normal;
              vViewDirWS = cameraPosition - worldPos.xyz;
              gl_Position = projectionMatrix * viewMatrix * worldPos;
              #include <logdepthbuf_vertex>
            }
          `,
          fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            varying vec3 vNormalWS;
            varying vec3 vViewDirWS;
            void main() {
              #include <logdepthbuf_fragment>
              vec3 n = vNormalWS * inversesqrt(max(dot(vNormalWS, vNormalWS), 1e-8));
              vec3 v = vViewDirWS * inversesqrt(max(dot(vViewDirWS, vViewDirWS), 1e-8));
              float x = clamp(0.62 - dot(n, v), 0.0, 1.0);
              float rim = x * x * sqrt(x);
              gl_FragColor = vec4(0.24, 0.64, 1.0, rim * 0.68);
            }
          `,
        });
        holder.add(new THREE.Mesh(new THREE.SphereGeometry(1.045, 40, 40), atmoMat));
      } else {
        const texUrl = PLANET_TEXTURE_URLS[body.id];
        let mat: THREE.ShaderMaterial;
        if (texUrl) {
          mat = createTexturedPlanetMaterial({
            map: this.loadSRGBTexture(texUrl),
            atmosphereColor: body.color,
            atmosphereStrength: ['venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(body.id)
              ? 0.34
              : 0.12,
          });
        } else {
          mat = createProceduralPlanetMaterial({
            planetType: body.planetType || 'Rocky',
            tempK: body.tempK,
            inHabitableZone: false,
            baseColor: body.color,
            seed: body.semiMajorAxisAu * 13.7,
          });
          this.animatedMaterials.add(mat);
        }

        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 36), mat);
        sphere.userData = { objectId: body.id, isPlanetSphere: true };
        holder.add(sphere);

        if (body.hasRings) {
          const isSat = body.id === 'saturn';
          const innerR = isSat ? 1.28 : 1.45;
          const outerR = isSat ? 2.38 : 1.88;
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 72);
          const ringMat = createPlanetaryRingMaterial(
            isSat ? '#ebd5a7' : '#7dd3fc',
            isSat
          );
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.x = isSat ? Math.PI / 2.25 : 0.16;
          holder.add(ringMesh);
        }
      }

      if (body.id !== 'sun') {
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
            opacity: body.id === 'earth' ? 0.35 : 0.18,
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
      scales[i] = isStation ? 2.1 : isTelescope ? 1.65 : 0.9;
      alphas[i] = 0.88;
      highlights[i] = isStation ? 1.0 : 0.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aHighlight', new THREE.BufferAttribute(highlights, 1));

    const mat = createCosmicPointsMaterial({
      baseSizePx: 5.5,
      maxSizePx: 18,
      diffractionSpikes: false,
    });
    this.satellitePoints = new THREE.Points(geo, mat);
    this.satellitePoints.frustumCulled = false;
    this.satelliteGroup.add(this.satellitePoints);
  }

  private buildStarsLayer() {
    if (this.starPoints) this.heliocentricMacroGroup.remove(this.starPoints);
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
    const sharedHzGeo = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < count; i++) {
      const s = this.stars[i];
      positions[i * 3] = s.posLy[0] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 1] = s.posLy[1] * RENDER_UNITS_PER_LY;
      positions[i * 3 + 2] = s.posLy[2] * RENDER_UNITS_PER_LY;

      tmpColor.set(starColorFromTempOrClass(s.teff, s.specClass));
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;

      scales[i] = Math.max(0.45, Math.min(3.2, (6.5 - s.mag) * 0.44));
      alphas[i] = Math.max(0.3, Math.min(0.96, (7.0 - s.mag) * 0.21));
      highlights[i] = 0.0;

      this.livePositionsLy.set(s.id, s.posLy);

      if ((s.distLy < 40 || s.proper) && this.starHzGroup.children.length < 120) {
        const outerAu = Math.max(0.05, Math.min(40, s.hzOuterAu));
        const hzDiameterUnits = outerAu * 2 * RENDER_UNITS_PER_AU;
        const ringMesh = new THREE.Mesh(sharedHzGeo, sharedHzMat);
        ringMesh.position.set(
          s.posLy[0] * RENDER_UNITS_PER_LY,
          s.posLy[1] * RENDER_UNITS_PER_LY,
          s.posLy[2] * RENDER_UNITS_PER_LY
        );
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.userData = { baseDiameterUnits: hzDiameterUnits };
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
      baseSizePx: 4.5,
      maxSizePx: 24,
      diffractionSpikes: true,
    });
    this.starPoints = new THREE.Points(geo, mat);
    this.starPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.starPoints);
  }

  private buildExoplanetsLayer() {
    if (this.exoplanetPoints) this.heliocentricMacroGroup.remove(this.exoplanetPoints);
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

      scales[i] = p.inHabitableZone ? 1.45 : p.isRecent ? 1.25 : 0.85;
      alphas[i] = 0.72;
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
      baseSizePx: 4.4,
      maxSizePx: 18,
      diffractionSpikes: false,
    });
    this.exoplanetPoints = new THREE.Points(geo, mat);
    this.exoplanetPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.exoplanetPoints);
  }

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
      this.constellationLinesMesh = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.18 })
      );
      this.constellationLinesMesh.frustumCulled = false;
      this.heliocentricMacroGroup.add(this.constellationLinesMesh);
    }

    if (zodiacVerts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(zodiacVerts, 3));
      this.zodiacLinesMesh = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.42 })
      );
      this.zodiacLinesMesh.frustumCulled = false;
      this.heliocentricMacroGroup.add(this.zodiacLinesMesh);
    }

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
      opacity: 0.25,
      dashSize: 5 * RENDER_UNITS_PER_LY,
      gapSize: 3 * RENDER_UNITS_PER_LY,
    });
    this.zodiacEclipticRing = new THREE.Line(eclGeo, eclMat);
    this.zodiacEclipticRing.computeLineDistances();
    this.zodiacEclipticRing.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.zodiacEclipticRing);
  }

  private buildDeepSpaceAndCosmicWeb() {
    this.landmarkGroup.clear();
    this.landmarkMeshes.clear();
    this.pendingLandmarkTextures = [];
    this.deepSpaceTexturesLoaded = false;
    if (!this.deepSpace) return;

    const allDeep: DeepSpaceRecord[] = [...this.deepSpace.landmarks, ...this.deepSpace.catalogDsos];
    const sharedPlane25D = new THREE.PlaneGeometry(1, 1, 24, 24);
    const sharedGlowPlane = new THREE.PlaneGeometry(1, 1);

    // Placeholder 1x1 dark pixel texture until deep-space textures lazy-load on zoom-out
    const placeholderData = new Uint8Array([18, 28, 48, 255]);
    const placeholderTex = new THREE.DataTexture(placeholderData, 1, 1);
    placeholderTex.needsUpdate = true;

    for (const d of allDeep) {
      if (d.id === 'jwst') continue;
      this.livePositionsLy.set(d.id, d.posLy);
      if (d.id === 'cmb-horizon') continue;

      if (d.renderAs25D && d.heroImage) {
        const mat = createTelescope25DMaterial({
          texture: placeholderTex,
          tintColor: d.color,
          spherical: d.category === 'black-hole',
          depthStrength: d.category === 'galaxy' ? 0.16 : 0.26,
        });
        this.animatedMaterials.add(mat);
        this.pendingLandmarkTextures.push({ mat, heroUrl: d.heroImage });

        const mesh = new THREE.Mesh(sharedPlane25D, mat);
        mesh.userData = {
          objectId: d.id,
          category: d.category,
          distLy: d.distLy,
          baseSizeLy: Math.max(2.0, d.sizeLy * 1.4),
          posLy: d.posLy,
        };
        this.landmarkMeshes.set(d.id, mesh);
        this.landmarkGroup.add(mesh);
      } else {
        // Soft additive radial nebula/cluster glow disc (NO giant enclosing wireframe spheres!)
        const glowMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: {
            uColor: { value: new THREE.Color(d.color) },
            uAlpha: { value: d.category === 'cosmic-structure' ? 0.22 : 0.55 },
          },
          vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              #include <logdepthbuf_vertex>
            }
          `,
          fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            uniform vec3 uColor;
            uniform float uAlpha;
            varying vec2 vUv;
            void main() {
              #include <logdepthbuf_fragment>
              float r = length(vUv - 0.5) * 2.0;
              if (r > 1.0) discard;
              float x = 1.0 - r;
              gl_FragColor = vec4(uColor, x * x * uAlpha);
            }
          `,
        });
        const capSizeLy =
          d.category === 'cosmic-structure'
            ? Math.min(d.sizeLy * 0.25, d.distLy * 0.35)
            : Math.max(0.1, d.sizeLy * 0.6);
        const mesh = new THREE.Mesh(sharedGlowPlane, glowMat);
        mesh.userData = {
          objectId: d.id,
          category: d.category,
          distLy: d.distLy,
          baseSizeLy: capSizeLy,
          posLy: d.posLy,
        };
        this.landmarkMeshes.set(d.id, mesh);
        this.landmarkGroup.add(mesh);
      }
    }

    // 3D Milky Way Barred Spiral Galaxy Disk
    const sgrA = this.deepSpace.landmarks.find((l) => l.id === 'sagittarius-a-star');
    const galCenterLy = sgrA ? sgrA.posLy : [-1300, -12900, 23300];
    const mwCount = 4800;
    const mwPos = new Float32Array(mwCount * 3);
    const mwCol = new Float32Array(mwCount * 3);
    const mwScale = new Float32Array(mwCount);
    const mwAlpha = new Float32Array(mwCount);
    const mwHigh = new Float32Array(mwCount);
    const cCore = new THREE.Color('#fde68a');
    const cArm = new THREE.Color('#7dd3fc');
    const cDust = new THREE.Color('#c084fc');

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
      mwAlpha[i] = 0.35;
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
      createCosmicPointsMaterial({ baseSizePx: 6.0, maxSizePx: 18, opacity: 0.0 })
    );
    this.milkyWayPoints.frustumCulled = false;
    this.heliocentricMacroGroup.add(this.milkyWayPoints);

    // 3D Cosmic Web Filaments & 46.5-Gly CMB Horizon (Extragalactic Scale LOD!)
    const nodesCount = 240;
    const webNodes: THREE.Vector3[] = [];
    for (let i = 0; i < nodesCount; i++) {
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

        for (let s = 0; s < 9; s++) {
          const t = Math.random();
          const spread = a.length() * 0.035;
          const gx = THREE.MathUtils.lerp(a.x, nb.b.x, t) + (Math.random() - 0.5) * spread;
          const gy = THREE.MathUtils.lerp(a.y, nb.b.y, t) + (Math.random() - 0.5) * spread;
          const gz = THREE.MathUtils.lerp(a.z, nb.b.z, t) + (Math.random() - 0.5) * spread;
          galFieldPos.push(gx * RENDER_UNITS_PER_LY, gy * RENDER_UNITS_PER_LY, gz * RENDER_UNITS_PER_LY);
          const col = s % 3 === 0 ? cFil3 : s % 2 === 0 ? cFil2 : cFil1;
          galFieldCol.push(col.r, col.g, col.b);
          galFieldScale.push(1.1);
          galFieldAlpha.push(0.45);
          galFieldHigh.push(0);
        }
      }
    }

    const filGeo = new THREE.BufferGeometry();
    filGeo.setAttribute('position', new THREE.Float32BufferAttribute(filamentVerts, 3));
    this.cosmicWebLines = new THREE.LineSegments(
      filGeo,
      new THREE.LineBasicMaterial({ color: '#6366f1', transparent: true, opacity: 0.22 })
    );
    this.cosmicWebLines.frustumCulled = false;
    this.cosmicWebLines.visible = false;
    this.heliocentricMacroGroup.add(this.cosmicWebLines);

    const cwGeo = new THREE.BufferGeometry();
    cwGeo.setAttribute('position', new THREE.Float32BufferAttribute(galFieldPos, 3));
    cwGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(galFieldCol, 3));
    cwGeo.setAttribute('aScale', new THREE.Float32BufferAttribute(galFieldScale, 1));
    cwGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(galFieldAlpha, 1));
    cwGeo.setAttribute('aHighlight', new THREE.Float32BufferAttribute(galFieldHigh, 1));
    this.cosmicWebPoints = new THREE.Points(
      cwGeo,
      createCosmicPointsMaterial({ baseSizePx: 5.0, maxSizePx: 16, opacity: 0.8 })
    );
    this.cosmicWebPoints.frustumCulled = false;
    this.cosmicWebPoints.visible = false;
    this.heliocentricMacroGroup.add(this.cosmicWebPoints);

    const cmbRadiusUnits = 46_500_000_000 * RENDER_UNITS_PER_LY;
    const cmbGeo = new THREE.SphereGeometry(cmbRadiusUnits, 40, 28);
    const cmbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { uOpacity: { value: 0.0 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = position * inversesqrt(max(dot(position, position), 1e-8));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uOpacity;
        varying vec3 vDir;
        void main() {
          if (uOpacity <= 0.005) discard;
          #include <logdepthbuf_fragment>
          float n = sin(vDir.x * 19.0) * cos(vDir.y * 23.0) * sin(vDir.z * 17.0) +
                    0.5 * cos(vDir.x * 43.0 + vDir.z * 37.0);
          vec3 coldSpot = vec3(0.05, 0.24, 0.62);
          vec3 warmSpot = vec3(0.78, 0.34, 0.12);
          vec3 col = mix(coldSpot, warmSpot, clamp(n * 0.5 + 0.5, 0.0, 1.0));
          float grid = smoothstep(0.985, 1.0, abs(sin(vDir.y * 24.0))) * 0.14;
          gl_FragColor = vec4(col + grid, uOpacity);
        }
      `,
    });
    this.cmbSphereMesh = new THREE.Mesh(cmbGeo, cmbMat);
    this.cmbSphereMesh.userData = { objectId: 'cmb-horizon' };
    this.cmbSphereMesh.frustumCulled = false;
    this.cmbSphereMesh.visible = false;
    this.heliocentricMacroGroup.add(this.cmbSphereMesh);
  }

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
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: b.color,
          transparent: true,
          opacity: b.id === 'sun' || b.id === 'earth' ? 0.9 : 0.65,
        })
      );
      line.frustumCulled = false;
      this.helicalGroup.add(line);
      this.helicalTrails.set(b.id, { pointsLy: [], line });
    }

    const pCount = 360;
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
      pAlpha[i] = 0.58;
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
      createCosmicPointsMaterial({ baseSizePx: 4.0, maxSizePx: 10, opacity: 0.7 })
    );
    this.velocityGridPoints.frustumCulled = false;
    this.helicalGroup.add(this.velocityGridPoints);

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

  private buildRouteLine() {
    this.routeGroup.clear();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const mat = new THREE.LineDashedMaterial({
      color: '#34d399',
      transparent: true,
      opacity: 0.85,
      dashSize: 1,
      gapSize: 0.5,
    });
    this.routeLine = new THREE.Line(geo, mat);
    this.routeLine.frustumCulled = false;
    this.routeGroup.add(this.routeLine);
  }

  private buildVisitedExoplanetSystem(targetId: string) {
    this.visitedExoSystemGroup.clear();
    const obj = this.catalogById.get(targetId);
    if (!obj || obj.category !== 'exoplanet' || !obj.raw) return;

    const exo = obj.raw as ExoplanetRecord;
    const siblings = this.exoplanets.filter((p) => p.hostStar === exo.hostStar);
    if (siblings.length === 0) return;

    this.visitedExoSystemGroup.userData = { anchorPosLy: exo.posLy, hostStar: exo.hostStar, siblings };

    const starColor = starColorFromTempOrClass(exo.starTeff, exo.starSpecClass);
    const starMat = createStarSurfaceMaterial(starColor);
    this.animatedMaterials.add(starMat);
    const starRadiusUnits = Math.max(0.12, exo.starRadiiSolar) * 696.34;
    const starMesh = new THREE.Mesh(new THREE.SphereGeometry(starRadiusUnits * 3.5, 36, 36), starMat);
    this.visitedExoSystemGroup.add(starMesh);

    const hzOuterUnits = Math.max(0.02, exo.hzOuterAu) * RENDER_UNITS_PER_AU * 2;
    const hzMat = createHabitableZoneMaterial();
    hzMat.uniforms.uInnerRatio.value = Math.min(0.92, exo.hzInnerAu / Math.max(0.001, exo.hzOuterAu));
    this.animatedMaterials.add(hzMat);
    const hzMesh = new THREE.Mesh(new THREE.PlaneGeometry(hzOuterUnits, hzOuterUnits), hzMat);
    hzMesh.rotation.x = Math.PI / 2;
    hzMesh.visible = this.layers.habitableZones;
    hzMesh.name = 'exo-hz-ring';
    this.visitedExoSystemGroup.add(hzMesh);

    siblings.forEach((sib, idx) => {
      const aAu = sib.semiMajorAxisAu || 0.04 * (idx + 1);
      const orbitRadiusUnits = aAu * RENDER_UNITS_PER_AU;

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
          opacity: sib.id === targetId ? 0.72 : 0.3,
        })
      );
      this.visitedExoSystemGroup.add(orbitLine);

      const pMat = createProceduralPlanetMaterial({
        planetType: sib.planetType,
        tempK: sib.tempK || 280,
        inHabitableZone: sib.inHabitableZone,
        baseColor: exoplanetColorFromType(sib.planetType, sib.inHabitableZone),
        seed: idx * 7.3 + sib.earthRadii,
      });
      this.animatedMaterials.add(pMat);
      const pRadiusUnits = Math.max(45, sib.earthRadii * 6.371 * 28);
      const pMesh = new THREE.Mesh(new THREE.SphereGeometry(pRadiusUnits, 32, 32), pMat);
      pMesh.userData = {
        objectId: sib.id,
        orbitRadiusUnits,
        periodDays: sib.orbPeriodDays || 12 * (idx + 1),
        phaseOffset: idx * 1.7,
      };
      this.visitedExoSystemGroup.add(pMesh);
    });
  }

  public setLayers(layers: LayerVisibility) {
    const prevHelical = this.layers.helicalMotion;
    this.layers = { ...layers };
    if (!prevHelical && layers.helicalMotion) {
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
    for (const line of this.solarOrbitLines.values()) line.visible = this.layers.planetOrbits;
    if (this.constellationLinesMesh) this.constellationLinesMesh.visible = this.layers.constellations;
    if (this.zodiacLinesMesh) this.zodiacLinesMesh.visible = this.layers.zodiacSigns || this.layers.constellations;
    if (this.zodiacEclipticRing) this.zodiacEclipticRing.visible = this.layers.zodiacSigns;
    if (this.sunHabitableZoneMesh) this.sunHabitableZoneMesh.visible = this.layers.habitableZones;
    this.starHzGroup.visible = this.layers.habitableZones;
    const exoHz = this.visitedExoSystemGroup.getObjectByName('exo-hz-ring');
    if (exoHz) exoHz.visible = this.layers.habitableZones;
    if (this.exoplanetPoints) this.exoplanetPoints.visible = this.layers.exoplanets;
    this.landmarkGroup.visible = this.layers.deepSpace;
    this.helicalGroup.visible = this.layers.helicalMotion;
    this.markerLayerEl.style.display = this.layers.labels ? 'block' : 'none';
  }

  public setFilters(filters: UniverseFilters) {
    this.filters = { ...filters };
    this.applyFilters();
  }

  private applyFilters() {
    const f = this.filters;
    const tmpCol = new THREE.Color();

    this.hasActiveExoFilter =
      f.planetTypes.length > 0 ||
      f.minEarthRadii > 0.15 ||
      f.maxEarthRadii < 24.9 ||
      f.habitableOnly ||
      f.recentDiscoveriesOnly ||
      f.discoveryFacility !== 'ALL';

    if (this.exoplanetPoints) {
      const geo = this.exoplanetPoints.geometry;
      const alphas = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
      const highlights = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      const colors = geo.getAttribute('aColor') as THREE.BufferAttribute;
      let matched = 0;

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
          highlights.setX(i, ok && this.hasActiveExoFilter ? 1.0 : 0.0);
        } else if (f.actionMode === 'highlight') {
          alphas.setX(i, ok ? 1.0 : 0.1);
          highlights.setX(i, ok && this.hasActiveExoFilter ? 1.0 : 0.0);
        } else {
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

        const baseAlpha = Math.max(0.3, Math.min(0.96, (7.0 - s.mag) * 0.21));
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

    if (this.satellitePoints) {
      const geo = this.satellitePoints.geometry;
      const alphas = geo.getAttribute('aAlpha') as THREE.BufferAttribute;
      const highlights = geo.getAttribute('aHighlight') as THREE.BufferAttribute;
      let matchedSats = 0;

      for (let i = 0; i < this.compiledSatellites.length; i++) {
        const sat = this.compiledSatellites[i].record;
        const ok = f.satelliteCategory === 'ALL' || sat.category === f.satelliteCategory;
        if (ok) matchedSats++;
        alphas.setX(i, ok ? 0.9 : f.actionMode === 'isolate' ? 0.0 : 0.12);
        highlights.setX(i, ok && f.satelliteCategory !== 'ALL' ? 1.0 : sat.category === 'Space Station' ? 1.0 : 0.0);
      }
      alphas.needsUpdate = true;
      highlights.needsUpdate = true;
      this.matchedCounts.satellites = matchedSats;
    }

    for (const [id, mesh] of this.landmarkMeshes.entries()) {
      const obj = this.catalogById.get(id);
      if (!obj) continue;
      mesh.userData.filterAllowed = f.deepSpaceCategory === 'ALL' || obj.category === f.deepSpaceCategory;
    }
  }

  public setOpticalMode(mode: OpticalMode) {
    if (mode === 'true-color') {
      this.scene.background = new THREE.Color('#02040a');
      this.renderer.domElement.style.filter = 'none';
    } else if (mode === 'tactical') {
      this.scene.background = new THREE.Color('#01090e');
      this.renderer.domElement.style.filter = 'contrast(1.12) saturate(1.22) hue-rotate(-8deg)';
    } else if (mode === 'infrared') {
      this.scene.background = new THREE.Color('#080204');
      this.renderer.domElement.style.filter = 'sepia(0.5) hue-rotate(-30deg) saturate(2.0) contrast(1.15)';
    } else if (mode === 'deep-field') {
      this.scene.background = new THREE.Color('#000003');
      this.renderer.domElement.style.filter = 'contrast(1.2) brightness(1.12) saturate(1.3)';
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
      } else if (['nebula', 'galaxy', 'black-hole', 'cluster'].includes(obj?.category || '')) {
        this.ensureDeepSpaceTexturesLoaded();
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
          desiredRadius = 14.5;
          break;
        case 'planet':
        case 'moon':
        case 'dwarf-planet': {
          const body = obj.raw as SolarSystemBody;
          desiredRadius = Math.max(15.5, (body.radiusKm / RENDER_KM_UNIT) * 3.8);
          break;
        }
        case 'star':
          desiredRadius = id === 'sun' ? 420_000 : 2.2 * RENDER_UNITS_PER_AU;
          break;
        case 'exoplanet':
          desiredRadius = Math.max(0.08, obj.semiMajorAxisAu || 0.15) * RENDER_UNITS_PER_AU * 1.4;
          this.buildVisitedExoplanetSystem(id);
          break;
        case 'spacecraft':
          desiredRadius = id === 'jwst' ? 8_000 : 1.5 * RENDER_UNITS_PER_AU;
          break;
        case 'nebula':
        case 'cluster': {
          this.ensureDeepSpaceTexturesLoaded();
          const ds = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(8, ds.sizeLy * 2.1) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'black-hole': {
          this.ensureDeepSpaceTexturesLoaded();
          const bh = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(2, bh.sizeLy * 2.8) * RENDER_UNITS_PER_LY;
          break;
        }
        case 'galaxy': {
          this.ensureDeepSpaceTexturesLoaded();
          const gal = obj.raw as DeepSpaceRecord;
          desiredRadius = Math.max(40_000, gal.sizeLy * 2.1) * RENDER_UNITS_PER_LY;
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
          desiredRadius = 360 * RENDER_UNITS_PER_LY;
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

  public jumpToScalePreset(
    preset:
      | 'earth-orbit'
      | 'solar-system'
      | 'interstellar'
      | 'milky-way'
      | 'local-group'
      | 'observable-universe'
  ) {
    if (preset === 'earth-orbit') this.flyToObject('earth', 17.5);
    else if (preset === 'solar-system') this.flyToObject('sun', 15 * RENDER_UNITS_PER_AU);
    else if (preset === 'interstellar') this.flyToObject('sun', 110 * RENDER_UNITS_PER_LY);
    else if (preset === 'milky-way') this.flyToObject('sagittarius-a-star', 130_000 * RENDER_UNITS_PER_LY);
    else if (preset === 'local-group') this.flyToObject('andromeda', 4_600_000 * RENDER_UNITS_PER_LY);
    else if (preset === 'observable-universe') this.flyToObject('cmb-horizon', 92_000_000_000 * RENDER_UNITS_PER_LY);
  }

  public getLivePositionLy(id: string): [number, number, number] {
    return this.livePositionsLy.get(id) || this.catalogById.get(id)?.basePosLy || [0, 0, 0];
  }

  private handleCanvasClick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    const meshCandidates: THREE.Object3D[] = [
      ...Array.from(this.solarMeshes.values()),
      ...this.visitedExoSystemGroup.children.filter((c) => c.userData?.objectId),
      ...Array.from(this.landmarkMeshes.values()).filter((m) => m.visible),
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

    let bestId: string | null = null;
    let bestDistPx = 24;
    const proj = this.projVec;

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

    if (this.layers.satellites && this.satellitePoints && camRadius < 180_000) {
      const posAttr = this.satellitePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const alphaAttr = this.satellitePoints.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
      const satOrigin = this.satelliteGroup.position;
      for (let i = 0; i < this.compiledSatellites.length; i++) {
        if (alphaAttr.getX(i) < 0.05) continue;
        proj.set(satOrigin.x + posAttr.getX(i), satOrigin.y + posAttr.getY(i), satOrigin.z + posAttr.getZ(i));
        testScreenCandidate(proj, this.compiledSatellites[i].record.id, 3);
      }
    }

    if (this.layers.exoplanets && this.exoplanetPoints && (camRadius > 5_000 || this.hasActiveExoFilter)) {
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

  private updateDynamicPositions(simDate: Date, forceUpdate = false) {
    const nowPerf = performance.now();

    // Throttle VSOP87 solar ephemeris math when running at gentle real-time speeds (90% CPU savings!)
    const shouldComputeSolar =
      forceUpdate ||
      this.layers.helicalMotion ||
      this.timeScale > 60 ||
      nowPerf - this.lastSolarEphemRealMs > 100;

    if (shouldComputeSolar) {
      this.lastSolarEphemRealMs = nowPerf;
      this.cachedEarthRotRad = getEarthSiderealRotationRad(simDate);

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

    // Distance-gated SGP4 satellite propagation
    const earthPosLy = this.livePositionsLy.get('earth') || [0, 0, 0];
    const distEarthToFocusUnits = Math.hypot(
      (earthPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
      (earthPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
      (earthPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
    );
    const camRadius = this.camera.position.length();
    const nearEarth = distEarthToFocusUnits + camRadius < 0.25 * RENDER_UNITS_PER_AU;

    if (this.satellitePoints) {
      const mat = this.satellitePoints.material as THREE.ShaderMaterial;
      const satFade = this.layers.satellites ? THREE.MathUtils.clamp(1.0 - (camRadius - 80) / 650, 0.0, 1.0) : 0.0;
      mat.uniforms.uGlobalOpacity.value = satFade;

      const shouldProp =
        forceUpdate ||
        (this.layers.satellites && nearEarth && satFade > 0.01 && (this.timeScale > 10 || nowPerf - this.lastSatPropRealMs > 80));

      if (shouldProp) {
        this.lastSatPropRealMs = nowPerf;
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
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const nowMs = performance.now();
    const dtSec = Math.min(0.08, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    this.frameCounter++;
    this.fpsAccumMs += dtSec * 1000;
    if (this.fpsAccumMs >= 600) {
      this.currentFps = Math.round((this.frameCounter * 1000) / this.fpsAccumMs);
      this.frameCounter = 0;
      this.fpsAccumMs = 0;
    }

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

    // Quintic smootherstep camera autopilot
    if (this.flyAnim?.active) {
      this.flyAnim.progress = Math.min(1, this.flyAnim.progress + dtSec * 1.15);
      const x = this.flyAnim.progress;
      const t = x * x * x * (x * (x * 6 - 15) + 10);
      const destLy = this.getLivePositionLy(this.flyAnim.targetId);
      this.focusPosLy = [
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[0], destLy[0], t),
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[1], destLy[1], t),
        THREE.MathUtils.lerp(this.flyAnim.startPosLy[2], destLy[2], t),
      ];

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
    const camLy = camRadius / RENDER_UNITS_PER_LY;
    const camAu = camRadius / RENDER_UNITS_PER_AU;
    const uTimeVal = nowMs * 0.001;

    // Scale-Aware Layer LOD (Keeps Earth Orbit crisp black velvet & fades in Galactic / Cosmic Web smoothly!)
    if (this.skyPanoramaMesh) {
      this.skyPanoramaMesh.position.copy(this.camera.position);
      const skyFade = THREE.MathUtils.clamp(1.0 - (camLy - 400) / 1200, 0.0, 1.0);
      this.skyPanoramaMesh.visible = skyFade > 0.01;
      (this.skyPanoramaMesh.material as THREE.MeshBasicMaterial).opacity = 0.22 * skyFade;
    }

    if (this.constellationLinesMesh) {
      this.constellationLinesMesh.visible = this.layers.constellations && camLy < 2400;
    }
    if (this.zodiacLinesMesh) {
      this.zodiacLinesMesh.visible = (this.layers.zodiacSigns || this.layers.constellations) && camLy < 2800;
    }
    if (this.zodiacEclipticRing) {
      this.zodiacEclipticRing.visible = this.layers.zodiacSigns && camLy < 2800;
    }

    if (this.exoplanetPoints) {
      const exoMat = this.exoplanetPoints.material as THREE.ShaderMaterial;
      const exoLodOpacity = this.hasActiveExoFilter
        ? 1.0
        : THREE.MathUtils.clamp(0.16 + camAu / 35, 0.16, 0.92) *
          THREE.MathUtils.clamp(1.0 - (camLy - 80_000) / 120_000, 0.0, 1.0);
      exoMat.uniforms.uGlobalOpacity.value = exoLodOpacity;
      this.exoplanetPoints.visible = this.layers.exoplanets && exoLodOpacity > 0.01;
    }

    if (this.milkyWayPoints) {
      const mwFade = this.layers.cosmicWeb
        ? THREE.MathUtils.clamp((camLy - 180) / 900, 0.0, 1.0) *
          THREE.MathUtils.clamp(1.0 - (camLy - 15_000_000) / 35_000_000, 0.0, 1.0)
        : 0.0;
      this.milkyWayPoints.visible = mwFade > 0.01;
      (this.milkyWayPoints.material as THREE.ShaderMaterial).uniforms.uGlobalOpacity.value = mwFade * 0.72;
    }

    // Extragalactic Cosmic Web & 46.5-Gly CMB Horizon ONLY appear when zooming out past Milky Way (> 120,000 ly)!
    const cosmicFade = this.layers.cosmicWeb
      ? THREE.MathUtils.clamp((camLy - 120_000) / 1_400_000, 0.0, 1.0)
      : 0.0;
    if (this.cosmicWebLines) {
      this.cosmicWebLines.visible = cosmicFade > 0.01;
      (this.cosmicWebLines.material as THREE.LineBasicMaterial).opacity = cosmicFade * 0.22;
    }
    if (this.cosmicWebPoints) {
      this.cosmicWebPoints.visible = cosmicFade > 0.01;
      (this.cosmicWebPoints.material as THREE.ShaderMaterial).uniforms.uGlobalOpacity.value = cosmicFade * 0.8;
    }
    if (this.cmbSphereMesh) {
      const cmbFade = this.layers.cosmicWeb
        ? THREE.MathUtils.clamp((camLy - 8_000_000) / 90_000_000, 0.0, 1.0)
        : 0.0;
      this.cmbSphereMesh.visible = cmbFade > 0.01;
      (this.cmbSphereMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = cmbFade * 0.16;
    }

    if (camLy > 0.3 && !this.deepSpaceTexturesLoaded) {
      this.ensureDeepSpaceTexturesLoaded();
    }

    for (const mat of this.animatedMaterials) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = uTimeVal;
    }

    this.heliocentricMacroGroup.position.set(
      -this.focusPosLy[0] * RENDER_UNITS_PER_LY,
      -this.focusPosLy[1] * RENDER_UNITS_PER_LY,
      -this.focusPosLy[2] * RENDER_UNITS_PER_LY
    );

    if (this.layers.habitableZones) {
      for (const child of this.starHzGroup.children) {
        const baseD = child.userData.baseDiameterUnits as number;
        const readableFloor = Math.min(2.5 * RENDER_UNITS_PER_LY, camRadius * 0.032);
        const s = Math.max(baseD, readableFloor);
        child.scale.set(s, s, 1);
      }
    }

    const sunPosLy = this.livePositionsLy.get('sun') || [0, 0, 0];
    const earthPosLy = this.livePositionsLy.get('earth') || [0, 0, 0];

    if (this.deepSpace) {
      for (const body of this.deepSpace.solarSystem) {
        const meshGroup = this.solarMeshes.get(body.id);
        const posLy = this.livePositionsLy.get(body.id);
        if (!meshGroup || !posLy) continue;

        const rx = (posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY;
        const ry = (posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY;
        const rz = (posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY;
        meshGroup.position.set(rx, ry, rz);

        const trueRadiusUnits = body.radiusKm / RENDER_KM_UNIT;
        let renderRadius = trueRadiusUnits;
        if (!this.layers.trueScaleBodies) {
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

        const sphere = meshGroup.children[0] as THREE.Mesh;
        if (sphere && body.id !== 'sun') {
          sphere.rotation.y = body.id === 'earth' ? this.cachedEarthRotRad : uTimeVal * 0.06;
          const pMat = sphere.material as THREE.ShaderMaterial;
          if (pMat.uniforms?.uSunDir) {
            pMat.uniforms.uSunDir.value
              .set(sunPosLy[0] - posLy[0], sunPosLy[1] - posLy[1], sunPosLy[2] - posLy[2])
              .normalize();
          }
        }
      }

      for (const [bodyId, line] of this.solarOrbitLines.entries()) {
        line.visible = this.layers.planetOrbits && camLy < 1.2;
        if (!line.visible) continue;
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

    this.satelliteGroup.position.set(
      (earthPosLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
      (earthPosLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
      (earthPosLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
    );

    // Update Deep-Space Landmarks with Scale Visibility & Zero Heap Allocations
    if (this.layers.deepSpace) {
      const showDeep = camAu > 0.25 || this.selectedObjectId != null;
      this.landmarkGroup.visible = showDeep;
      if (showDeep) {
        for (const [id, mesh] of this.landmarkMeshes.entries()) {
          if (mesh.userData.filterAllowed === false) {
            mesh.visible = false;
            continue;
          }
          const cat = mesh.userData.category as string;
          if (cat === 'cosmic-structure' && camLy < 1_500_000 && this.selectedObjectId !== id) {
            mesh.visible = false;
            continue;
          }
          if (camLy < 0.2 && this.selectedObjectId !== id && id !== 'voyager-1') {
            mesh.visible = false;
            continue;
          }
          mesh.visible = true;

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
          const readableMin = Math.min(baseSizeUnits * 6, dCam * 0.032);
          mesh.scale.setScalar(Math.max(baseSizeUnits, readableMin));

          this.tmpMat4.lookAt(this.camera.position, mesh.position, this.camera.up);
          this.tmpQuat.setFromRotationMatrix(this.tmpMat4);
          mesh.quaternion.slerp(this.tmpQuat, 0.06);
        }
      }
    }

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

      if (this.velocityGridPoints) {
        const boxSpanUnits = Math.max(40, camRadius * 1.6);
        this.velocityGridPoints.scale.setScalar(boxSpanUnits);
        const posAttr = this.velocityGridPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        const normSpeed = this.playing
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

    // Direct Hardware-MSAA Single-Pass Render (Zero offscreen FBO copies, zero NaN bloom blocks!)
    this.renderer.render(this.scene, this.camera);

    // Update Zero-Lag Direct DOM Labels
    if (this.layers.labels) {
      this.updateDomMarkers(camRadius);
    }

    // Throttle React telemetry HUD updates to 4 Hz
    if (nowMs - this.lastTelemetryBroadcastMs >= 250) {
      this.lastTelemetryBroadcastMs = nowMs;
      this.broadcastTelemetry(camRadius, originPosLy, targetPosLy);
    }
  };

  private updateDomMarkers(camRadiusUnits: number) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camLy = camRadiusUnits / RENDER_UNITS_PER_LY;
    const camAu = camRadiusUnits / RENDER_UNITS_PER_AU;
    const camKm = camRadiusUnits * RENDER_KM_UNIT;

    const placed: { x: number; y: number }[] = [];
    let used = 0;
    const proj = this.projVec;

    const emitMarker = (
      id: string,
      name: string,
      color: string,
      posLy: [number, number, number],
      tagText = '',
      isHighlighted = false,
      force = false
    ) => {
      if (used >= MAX_DOM_MARKERS) return;
      proj.set(
        (posLy[0] - this.focusPosLy[0]) * RENDER_UNITS_PER_LY,
        (posLy[1] - this.focusPosLy[1]) * RENDER_UNITS_PER_LY,
        (posLy[2] - this.focusPosLy[2]) * RENDER_UNITS_PER_LY
      );
      proj.project(this.camera);
      if (proj.z < -1 || proj.z > 1) return;

      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      if (x < 48 || x > w - 48 || y < 74 || y > h - 90) return;

      if (!force) {
        for (let i = 0; i < placed.length; i++) {
          if (Math.abs(placed[i].x - x) < 104 && Math.abs(placed[i].y - y) < 32) return;
        }
      }

      placed.push({ x, y });
      const slot = this.markerPool[used++];
      slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;

      if (!slot.visible) {
        slot.el.style.display = 'flex';
        slot.visible = true;
      }
      if (slot.boundId !== id) {
        slot.boundId = id;
        slot.label.textContent = name;
        slot.dot.style.backgroundColor = color;
      }
      if (tagText) {
        slot.tag.textContent = tagText;
        slot.tag.style.display = 'inline-block';
      } else {
        slot.tag.style.display = 'none';
      }

      slot.el.style.borderColor = isHighlighted ? 'rgba(34,211,238,0.85)' : 'rgba(255,255,255,0.14)';
      slot.el.style.zIndex = isHighlighted ? '25' : '10';
    };

    if (this.selectedObjectId) {
      const sel = this.catalogById.get(this.selectedObjectId);
      if (sel) {
        emitMarker(sel.id, sel.name, '#22d3ee', this.getLivePositionLy(sel.id), 'TARGET', true, true);
      }
    }

    if (camAu < 80 && this.deepSpace) {
      for (const b of this.deepSpace.solarSystem) {
        if (b.id === this.selectedObjectId) continue;
        if (b.id === 'moon' && camAu > 0.08) continue;
        emitMarker(b.id, b.name, b.color, this.getLivePositionLy(b.id));
      }
      if (this.layers.satellites && camKm < 80_000) {
        for (const comp of this.labelSatellites) {
          emitMarker(comp.record.id, comp.record.name, '#fde047', this.getLivePositionLy(comp.record.id), 'LIVE');
        }
      }
      if (camAu > 0.004) emitMarker('jwst', 'JWST (L2)', '#fbbf24', this.getLivePositionLy('jwst'));
      if (camAu > 12) emitMarker('voyager-1', 'Voyager 1', '#38bdf8', this.getLivePositionLy('voyager-1'));
    }

    if (this.layers.zodiacSigns && camLy >= 0.02 && camLy < 2000) {
      for (const c of this.constellations) {
        if (!c.isZodiac || !c.zodiac) continue;
        emitMarker(`const-${c.id}`, `${c.zodiac.symbol} ${c.name}`, '#fbbf24', c.labelPosLy);
      }
    }
    if (this.layers.constellations && camLy >= 0.02 && camLy < 1200) {
      for (const c of this.constellations) {
        if (c.isZodiac) continue;
        if (['Ori', 'UMa', 'Cas', 'Cyg', 'Cen', 'Cru', 'Lyr', 'CMa', 'And'].includes(c.id)) {
          emitMarker(`const-${c.id}`, c.name, '#60a5fa', c.labelPosLy);
        }
      }
    }

    if (camLy >= 0.4 && camLy < 8_000) {
      for (const s of this.labelStars) {
        emitMarker(s.id, s.proper || s.name, starColorFromTempOrClass(s.teff, s.specClass), s.posLy);
        if (used > 18) break;
      }
      if (this.layers.exoplanets) {
        for (const p of this.labelExoplanets) {
          emitMarker(p.id, p.name, p.inHabitableZone ? '#34d399' : '#38bdf8', p.posLy, p.inHabitableZone ? 'HZ' : '');
          if (used > 22) break;
        }
      }
    }

    if (this.layers.deepSpace && this.deepSpace && camLy >= 0.4) {
      for (const lm of this.deepSpace.landmarks) {
        if (lm.id === 'jwst' || lm.id === 'voyager-1') continue;
        if (lm.distLy > camLy * 65 && camLy < 500) continue;
        if (lm.distLy < camLy * 0.002 && camLy > 50_000_000) continue;
        emitMarker(lm.id, lm.name, lm.color, lm.posLy);
      }
    }

    for (let i = used; i < MAX_DOM_MARKERS; i++) {
      if (this.markerPool[i].visible) {
        this.markerPool[i].el.style.display = 'none';
        this.markerPool[i].visible = false;
      }
    }
  }

  private broadcastTelemetry(
    camRadiusUnits: number,
    originPosLy: [number, number, number],
    targetPosLy: [number, number, number] | null
  ) {
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
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.cleanupListeners();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.markerLayerEl.parentElement) {
      this.markerLayerEl.parentElement.removeChild(this.markerLayerEl);
    }
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
