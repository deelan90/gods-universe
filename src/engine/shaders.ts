import * as THREE from 'three';

/**
 * Clever 2.5D / Pseudo-3D Telescope Image Perspective Shader!
 * - When `uSpherical > 0.5` (Planetary / Spherical Lensing Mode):
 *   Maps a single 2D telescope capture onto a 3D perspective-warped sphere/billboard with hemispherical UV lensing,
 *   camera-orbit perspective shift, luminance-derived micro-relief normals, limb darkening, and Fresnel atmosphere!
 * - When `uSpherical <= 0.5` (Volumetric Deep-Space Relief Mode):
 *   Combines 3D vertex relief displacement with multi-layer ray-marched Parallax Occlusion Mapping (POM)
 *   and radial vignette feathering so 2D JWST/Hubble nebula & galaxy photos behave like volumetric 3D objects in space!
 */
export function createTelescope25DMaterial(params: {
  texture: THREE.Texture;
  tintColor?: string;
  spherical?: boolean;
  depthStrength?: number;
  opacity?: number;
}): THREE.ShaderMaterial {
  const tint = new THREE.Color(params.tintColor || '#ffffff');
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: Boolean(params.spherical),
    blending: params.spherical ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: params.texture },
      uTint: { value: tint },
      uSpherical: { value: params.spherical ? 1.0 : 0.0 },
      uDepth: { value: params.depthStrength ?? (params.spherical ? 0.24 : 0.22) },
      uOpacity: { value: params.opacity ?? 1.0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      uniform sampler2D uMap;
      uniform float uSpherical;
      uniform float uDepth;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vNormalOS;
      varying vec3 vViewDirOS;

      void main() {
        vUv = uv;
        vNormalOS = normalize(normal);

        // Compute object-space camera position for genuine perspective parallax as user orbits!
        vec3 camPosOS = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vec3 pos = position;

        if (uSpherical < 0.5) {
          // Sample telescope brightness to extrude 3D relief silhouette on subdivided plane
          vec4 tex = texture2D(uMap, uv);
          float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
          float radial = smoothstep(0.52, 0.08, length(uv - 0.5));
          pos.z += (lum - 0.25) * uDepth * 0.9 * radial;
          // Subtle ellipsoidal dome curvature
          pos.z += radial * uDepth * 0.35;
        }

        vViewDirOS = normalize(camPosOS - pos);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform float uSpherical;
      uniform float uDepth;
      uniform float uOpacity;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vNormalOS;
      varying vec3 vViewDirOS;

      float getHeight(vec2 uv) {
        vec3 c = texture2D(uMap, clamp(uv, 0.002, 0.998)).rgb;
        return dot(c, vec3(0.32, 0.52, 0.16));
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 V = normalize(vViewDirOS);

        if (uSpherical > 0.5) {
          // Clever Planetary 2.5D Spherical Lensing:
          // Treat quad/disc as an optical 3D sphere whose apparent surface perspective shifts as V changes!
          vec2 p = (vUv - 0.5) * 2.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;

          float zSphere = sqrt(max(0.0, 1.0 - r2));
          vec3 sphereNormal = normalize(vec3(p.x, p.y, zSphere));

          // Shift spherical coordinates subtly with camera orbit angle for convincing 3D rotation perspective!
          vec2 orbitShift = V.xy * uDepth * 0.65;
          float lon = atan(sphereNormal.x + orbitShift.x, sphereNormal.z) / (PI * 0.52);
          float lat = asin(clamp(sphereNormal.y + orbitShift.y * 0.6, -0.99, 0.99)) / (PI * 0.52);

          vec2 sphereUv = clamp(vec2(lon, lat) * 0.44 + 0.5, 0.02, 0.98);

          // Micro-relief bump normal from telescope image luminance gradient
          float hC = getHeight(sphereUv);
          float hX = getHeight(sphereUv + vec2(0.006, 0.0));
          float hY = getHeight(sphereUv + vec2(0.0, 0.006));
          vec3 bumpN = normalize(sphereNormal + vec3((hC - hX) * 2.2, (hC - hY) * 2.2, 0.0));

          vec3 lightDir = normalize(vec3(0.55, 0.35, 0.75));
          float diff = clamp(dot(bumpN, lightDir) * 0.65 + 0.48, 0.12, 1.25);

          vec3 col = texture2D(uMap, sphereUv).rgb * diff;

          // Atmospheric Fresnel rim glow + smooth antialiasing limb
          float fresnel = pow(1.0 - zSphere, 3.2);
          col += uTint * fresnel * 0.45;
          float edgeAlpha = smoothstep(1.0, 0.965, r2);

          gl_FragColor = vec4(col, edgeAlpha * uOpacity);
          return;
        }

        // Volumetric Deep-Space 8-Layer Steep Parallax Ray-Marching (Nebulae, Galaxies, Supernova Remnants)
        float distFromCenter = length(vUv - 0.5);
        float edgeMask = smoothstep(0.5, 0.22, distFromCenter);
        if (edgeMask <= 0.003) discard;

        vec2 parallaxDir = (V.xy / max(0.32, abs(V.z))) * uDepth * 0.18;
        const int STEPS = 8;
        vec3 accum = vec3(0.0);
        float weightSum = 0.0;

        for (int i = 0; i < STEPS; i++) {
          float t = (float(i) / float(STEPS - 1)) - 0.5;
          vec2 sampleUv = clamp(vUv + parallaxDir * t, 0.004, 0.996);
          vec3 sampleCol = texture2D(uMap, sampleUv).rgb;
          float lum = dot(sampleCol, vec3(0.299, 0.587, 0.114));
          // Weight brighter layers toward front, darker filament dust toward rear
          float layerMatch = 1.0 - abs(t - (lum - 0.45) * 0.85);
          float w = max(0.08, layerMatch * layerMatch);
          accum += sampleCol * w;
          weightSum += w;
        }

        vec3 finalCol = (accum / max(0.001, weightSum));
        // Subtle view-angle rim enhancement so volume shimmers naturally during 3D flybys
        float obliqueBoost = 1.0 + (1.0 - abs(V.z)) * 0.28;
        finalCol *= mix(vec3(1.0), uTint, 0.18) * obliqueBoost;

        float lumAlpha = clamp(dot(finalCol, vec3(0.35, 0.45, 0.25)) * 1.45 + 0.12, 0.0, 1.0);
        gl_FragColor = vec4(finalCol, edgeMask * lumAlpha * uOpacity);
      }
    `,
  });
}

/**
 * Physically-driven Procedural 3D Planet / Exoplanet Shader
 * Renders oceans, continents, clouds, craters, lava fissures, or turbulent gas-giant bands
 * directly from real NASA Exoplanet Archive parameters!
 */
export function createProceduralPlanetMaterial(params: {
  planetType: string;
  tempK: number;
  inHabitableZone: boolean;
  baseColor: string;
  seed: number;
}): THREE.ShaderMaterial {
  let mode = 0; // 0 = Rocky barren, 1 = Habitable/Earth-like, 2 = Gas/Ice Giant, 3 = Lava World
  if (params.planetType === 'Lava World' || params.tempK > 1250) {
    mode = 3;
  } else if (params.planetType === 'Gas Giant' || params.planetType === 'Ice Giant') {
    mode = 2;
  } else if (params.inHabitableZone || (params.tempK >= 200 && params.tempK <= 330)) {
    mode = 1;
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color(params.baseColor) },
      uMode: { value: mode },
      uSeed: { value: params.seed },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec3 vNormalWS;
      varying vec3 vPosOS;
      varying vec3 vViewDirWS;

      void main() {
        vPosOS = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = normalize(mat3(modelMatrix) * normal);
        vViewDirWS = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform vec3 uBaseColor;
      uniform float uMode;
      uniform float uSeed;
      uniform float uTime;
      uniform vec3 uSunDir;

      varying vec3 vNormalWS;
      varying vec3 vPosOS;
      varying vec3 vViewDirWS;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed * 0.017);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = normalize(vNormalWS);
        vec3 V = normalize(vViewDirWS);
        vec3 L = normalize(uSunDir);

        float ndotl = max(0.0, dot(N, L));
        float dayLight = smoothstep(-0.12, 0.85, dot(N, L)) * 0.92 + 0.08;
        float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.2);

        vec3 p = vPosOS;
        vec3 surfCol = uBaseColor;
        vec3 emissive = vec3(0.0);

        if (uMode > 2.5) {
          // Lava World: Dark basalt plates + glowing incandescent magma cracks
          float n = fbm(p * 4.5 + vec3(uTime * 0.02));
          float cracks = smoothstep(0.46, 0.53, n);
          surfCol = mix(vec3(0.09, 0.06, 0.06), vec3(0.25, 0.12, 0.08), n);
          emissive = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.82, 0.25), smoothstep(0.5, 0.68, n)) * cracks * 1.35;
          emissive += vec3(0.95, 0.22, 0.02) * fresnel * 0.55;
        } else if (uMode > 1.5) {
          // Gas / Ice Giant: Zonal jet-stream bands + turbulent storm eddies
          float turb = fbm(p * 3.8 + vec3(uTime * 0.03, 0.0, 0.0));
          float bands = sin(p.y * 18.0 + turb * 5.2);
          vec3 lightBand = mix(uBaseColor, vec3(0.98, 0.95, 0.88), 0.38);
          vec3 darkBand = uBaseColor * 0.58;
          surfCol = mix(darkBand, lightBand, bands * 0.5 + 0.5);
          emissive = uBaseColor * fresnel * 0.35;
        } else if (uMode > 0.5) {
          // Habitable / Ocean-Continent World + Specular Oceans + Cloud Deck + Rayleigh Sky
          float elev = fbm(p * 3.6);
          float isLand = smoothstep(0.49, 0.525, elev);
          vec3 ocean = mix(vec3(0.04, 0.18, 0.46), vec3(0.08, 0.42, 0.68), smoothstep(0.32, 0.49, elev));
          vec3 land = mix(vec3(0.14, 0.44, 0.20), vec3(0.55, 0.46, 0.32), smoothstep(0.53, 0.75, elev));
          // Polar ice caps
          float ice = smoothstep(0.74, 0.88, abs(p.y) + elev * 0.14);
          surfCol = mix(ocean, land, isLand);
          surfCol = mix(surfCol, vec3(0.93, 0.96, 1.0), ice);

          // Ocean sun glint
          vec3 H = normalize(L + V);
          float spec = pow(max(0.0, dot(N, H)), 36.0) * (1.0 - isLand) * (1.0 - ice) * ndotl;
          surfCol += vec3(0.65, 0.82, 1.0) * spec * 0.55;

          // Swirling clouds
          float clouds = smoothstep(0.54, 0.72, fbm(p * 4.4 + vec3(uTime * 0.025, 0.0, uTime * 0.01)));
          surfCol = mix(surfCol, vec3(0.97, 0.99, 1.0), clouds * 0.62);

          // Rayleigh blue atmosphere rim
          emissive = vec3(0.24, 0.62, 1.0) * fresnel * (0.45 + 0.4 * ndotl);
        } else {
          // Rocky Terrestrial / Cratered Regolith
          float n = fbm(p * 5.2);
          float detail = fbm(p * 14.0);
          surfCol = uBaseColor * (0.68 + 0.55 * n) * (0.85 + 0.3 * detail);
          float polar = smoothstep(0.84, 0.95, abs(p.y) + n * 0.08);
          surfCol = mix(surfCol, vec3(0.88, 0.9, 0.94), polar * 0.45);
          emissive = uBaseColor * fresnel * 0.18;
        }

        gl_FragColor = vec4(surfCol * dayLight + emissive, 1.0);
      }
    `,
  });
}

/**
 * Boiling 3D Star Photosphere & Corona Shader
 */
export function createStarSurfaceMaterial(starColor: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(starColor) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec3 vPosOS;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vPosOS = normalize(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = normalize(mat3(modelMatrix) * normal);
        vViewDirWS = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform vec3 uColor;
      uniform float uTime;

      varying vec3 vPosOS;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 p = vPosOS * 8.0 + vec3(uTime * 0.18, -uTime * 0.12, uTime * 0.09);
        float gran = noise(p) * 0.55 + noise(p * 2.4) * 0.3 + noise(p * 5.2) * 0.15;
        float ndotv = max(0.0, dot(normalize(vNormalWS), normalize(vViewDirWS)));
        float limb = pow(ndotv, 0.45);
        vec3 core = mix(uColor * 0.72, vec3(1.0, 0.99, 0.94), gran * limb);
        vec3 rim = uColor * pow(1.0 - ndotv, 2.2) * 1.4;
        gl_FragColor = vec4(core + rim, 1.0);
      }
    `,
  });
}

/**
 * Circumstellar Habitable Zone Goldilocks Ring Shader (Inner AU -> Outer AU)
 */
export function createHabitableZoneMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uInnerRatio: { value: 0.56 },
      uTime: { value: 0 },
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

      uniform float uInnerRatio;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0 || r < uInnerRatio) discard;

        float bandT = (r - uInnerRatio) / max(0.01, 1.0 - uInnerRatio);
        float softEdges = sin(bandT * PI);
        float pulse = 0.85 + 0.15 * sin(r * 24.0 - uTime * 2.0);
        vec3 col = mix(vec3(0.16, 0.92, 0.58), vec3(0.08, 0.72, 0.88), bandT);
        float edgeRing = smoothstep(0.06, 0.0, abs(bandT - 0.03)) + smoothstep(0.06, 0.0, abs(bandT - 0.97));
        float alpha = (softEdges * 0.24 + edgeRing * 0.35) * pulse;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * GPU Point-Cloud Shader with Logarithmic Depth Buffer + Per-Point Filter Alpha/Highlight
 * Powers 6,800+ 3D Stars, 6,400+ Exoplanets, 450+ Satellites, Milky Way Spiral Arms & Cosmic Web at 60 FPS!
 */
export function createCosmicPointsMaterial(params: {
  baseSizePx: number;
  maxSizePx?: number;
  diffractionSpikes?: boolean;
  opacity?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uBaseSize: { value: params.baseSizePx },
      uMaxSize: { value: params.maxSizePx ?? 36.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uSpikes: { value: params.diffractionSpikes ? 1.0 : 0.0 },
      uGlobalOpacity: { value: params.opacity ?? 1.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      attribute vec3 aColor;
      attribute float aScale;
      attribute float aAlpha;
      attribute float aHighlight;

      uniform float uBaseSize;
      uniform float uMaxSize;
      uniform float uPixelRatio;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vHighlight;

      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vHighlight = aHighlight;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float sz = uBaseSize * aScale * (1.0 + aHighlight * 0.65) * uPixelRatio;
        gl_PointSize = clamp(sz, 1.5, uMaxSize * uPixelRatio);

        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform float uSpikes;
      uniform float uGlobalOpacity;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vHighlight;

      void main() {
        if (vAlpha <= 0.005) discard;
        #include <logdepthbuf_fragment>

        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float d = length(p);
        if (d > 1.0) discard;

        float core = exp(-d * d * 7.5);
        float halo = pow(max(0.0, 1.0 - d), 2.4) * 0.55;

        float spikes = 0.0;
        if (uSpikes > 0.5) {
          spikes = (exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.4) +
                    exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.4)) * 0.35;
        }

        // Tactical highlight reticle ring when object matches user's Highlight filter!
        float ring = 0.0;
        if (vHighlight > 0.5) {
          ring = smoothstep(0.11, 0.0, abs(d - 0.78)) * 0.95;
        }

        float intensity = core + halo + spikes + ring;
        vec3 col = mix(vColor, vec3(1.0), core * 0.65) + vec3(0.25, 0.95, 0.85) * ring * 0.5;
        gl_FragColor = vec4(col, clamp(intensity * vAlpha * uGlobalOpacity, 0.0, 1.0));
      }
    `,
  });
}


/**
 * Photorealistic 3D Earth Shader:
 * Blends NASA Blue Marble Day Map + Night-Side City Lights + Drifting Cloud Deck + Specular Glint + Rayleigh Sky Halo!
 */
export function createTexturedEarthMaterial(params: {
  dayMap: THREE.Texture;
  nightMap: THREE.Texture;
  cloudsMap: THREE.Texture;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDayMap: { value: params.dayMap },
      uNightMap: { value: params.nightMap },
      uCloudsMap: { value: params.cloudsMap },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = normalize(mat3(modelMatrix) * normal);
        vViewDirWS = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      uniform sampler2D uCloudsMap;
      uniform vec3 uSunDir;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = normalize(vNormalWS);
        vec3 V = normalize(vViewDirWS);
        vec3 L = normalize(uSunDir);

        float cosTheta = dot(N, L);
        float dayFactor = smoothstep(-0.16, 0.24, cosTheta);
        float diffuse = max(0.04, smoothstep(-0.08, 0.92, cosTheta));

        vec3 dayTex = texture2D(uDayMap, vUv).rgb;
        vec3 nightTex = texture2D(uNightMap, vUv).rgb;

        // Subtle drifting cloud UVs
        vec2 cloudUv = vec2(fract(vUv.x + uTime * 0.0018), vUv.y);
        float cloudVal = texture2D(uCloudsMap, cloudUv).r;

        // Specular sun glint over oceans (where blue dominates red/green)
        float oceanMask = clamp((dayTex.b - max(dayTex.r, dayTex.g) * 0.85) * 4.5, 0.0, 1.0) * (1.0 - cloudVal);
        vec3 H = normalize(L + V);
        float spec = pow(max(0.0, dot(N, H)), 42.0) * oceanMask * max(0.0, cosTheta);

        vec3 litDay = mix(dayTex, vec3(0.98, 0.99, 1.0), cloudVal * 0.78) * diffuse + vec3(0.75, 0.88, 1.0) * spec * 0.55;
        vec3 litNight = nightTex * vec3(1.25, 0.96, 0.65) * (1.0 - cloudVal * 0.65) * 1.15 + dayTex * 0.03;

        vec3 surface = mix(litNight, litDay, dayFactor);

        // Warm sunset twilight band along terminator + Rayleigh blue atmospheric rim
        float twilight = exp(-pow(cosTheta * 5.5, 2.0)) * 0.24;
        float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.0);
        vec3 atmoColor = mix(vec3(0.12, 0.38, 0.88), vec3(0.32, 0.72, 1.0), dayFactor);
        vec3 twilightColor = vec3(1.0, 0.42, 0.16) * twilight * fresnel * 1.6;

        gl_FragColor = vec4(surface + atmoColor * fresnel * (0.35 + 0.55 * dayFactor) + twilightColor, 1.0);
      }
    `,
  });
}

/**
 * Photorealistic Textured Solar System Planet / Moon Shader
 */
export function createTexturedPlanetMaterial(params: {
  map: THREE.Texture;
  atmosphereColor: string;
  atmosphereStrength?: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: params.map },
      uAtmoColor: { value: new THREE.Color(params.atmosphereColor) },
      uAtmoStrength: { value: params.atmosphereStrength ?? 0.32 },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = normalize(mat3(modelMatrix) * normal);
        vViewDirWS = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform sampler2D uMap;
      uniform vec3 uAtmoColor;
      uniform float uAtmoStrength;
      uniform vec3 uSunDir;

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = normalize(vNormalWS);
        vec3 V = normalize(vViewDirWS);
        vec3 L = normalize(uSunDir);

        float diff = smoothstep(-0.18, 0.88, dot(N, L)) * 0.93 + 0.07;
        vec3 tex = texture2D(uMap, vUv).rgb;
        float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.2);

        gl_FragColor = vec4(tex * diff + uAtmoColor * fresnel * uAtmoStrength, 1.0);
      }
    `,
  });
}

/**
 * High-Detail Concentric Planetary Ring Shader (Cassini Division & Multi-Band Ice Optical Depth)
 */
export function createPlanetaryRingMaterial(colorHex: string, isSaturn: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIsSaturn: { value: isSaturn ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vPosOS;
      void main() {
        vPosOS = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform vec3 uColor;
      uniform float uIsSaturn;
      varying vec3 vPosOS;

      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vPosOS.xy);

        if (uIsSaturn > 0.5) {
          float t = clamp((r - 1.28) / (2.38 - 1.28), 0.0, 1.0);
          // Cassini division gap around t = 0.63 + fine ringlets
          float cassiniGap = 1.0 - smoothstep(0.04, 0.0, abs(t - 0.64)) * 0.88;
          float enckeGap = 1.0 - smoothstep(0.015, 0.0, abs(t - 0.88)) * 0.7;
          float fineBands = 0.72 + 0.28 * sin(t * 95.0) * cos(t * 37.0);
          float edgeFade = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.93, t);
          vec3 ringCol = mix(uColor * 0.78, vec3(0.97, 0.93, 0.84), fineBands);
          gl_FragColor = vec4(ringCol, edgeFade * cassiniGap * enckeGap * 0.78);
        } else {
          float t = clamp((r - 1.45) / (1.88 - 1.45), 0.0, 1.0);
          float ringlets = pow(0.5 + 0.5 * sin(t * 42.0), 2.0);
          float edgeFade = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);
          gl_FragColor = vec4(uColor, edgeFade * ringlets * 0.35);
        }
      }
    `,
  });
}
