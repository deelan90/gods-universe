import * as THREE from 'three';

const GLSL_SAFE_MATH = /* glsl */ `
  vec3 safeNorm(vec3 v) {
    return v * inversesqrt(max(dot(v, v), 1e-8));
  }
  float safePow(float base, float expVal) {
    return pow(max(base, 1e-4), expVal);
  }
  float safeAtan(float y, float x) {
    return (abs(x) + abs(y) < 1e-6) ? 0.0 : atan(y, x);
  }
`;

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
      ${GLSL_SAFE_MATH}

      uniform sampler2D uMap;
      uniform float uSpherical;
      uniform float uDepth;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vNormalOS;
      varying vec3 vViewDirOS;

      void main() {
        vUv = uv;
        vNormalOS = safeNorm(normal);

        vec3 camPosOS = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vec3 pos = position;

        if (uSpherical < 0.5) {
          vec4 tex = texture2D(uMap, uv);
          float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
          float radial = smoothstep(0.52, 0.08, length(uv - 0.5));
          pos.z += (lum - 0.25) * uDepth * 0.9 * radial;
          pos.z += radial * uDepth * 0.35;
        }

        vViewDirOS = safeNorm(camPosOS - pos);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

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

        vec3 V = safeNorm(vViewDirOS);

        if (uSpherical > 0.5) {
          vec2 p = (vUv - 0.5) * 2.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;

          float zSphere = sqrt(max(0.0, 1.0 - r2));
          vec3 sphereNormal = safeNorm(vec3(p.x, p.y, zSphere));

          vec2 orbitShift = V.xy * uDepth * 0.65;
          float lon = atan(sphereNormal.x + orbitShift.x, max(1e-4, sphereNormal.z)) / (PI * 0.52);
          float lat = asin(clamp(sphereNormal.y + orbitShift.y * 0.6, -0.99, 0.99)) / (PI * 0.52);

          vec2 sphereUv = clamp(vec2(lon, lat) * 0.44 + 0.5, 0.02, 0.98);

          float hC = getHeight(sphereUv);
          float hX = getHeight(sphereUv + vec2(0.006, 0.0));
          float hY = getHeight(sphereUv + vec2(0.0, 0.006));
          vec3 bumpN = safeNorm(sphereNormal + vec3((hC - hX) * 2.2, (hC - hY) * 2.2, 0.0));

          vec3 lightDir = safeNorm(vec3(0.55, 0.35, 0.75));
          float diff = clamp(dot(bumpN, lightDir) * 0.65 + 0.48, 0.12, 1.25);

          vec3 col = texture2D(uMap, sphereUv).rgb * diff;

          float fresnel = safePow(1.0 - zSphere, 3.2);
          col += uTint * fresnel * 0.45;
          float edgeAlpha = smoothstep(1.0, 0.965, r2);

          gl_FragColor = vec4(col, edgeAlpha * uOpacity);
          return;
        }

        // Volumetric Deep-Space 5-Layer Steep Parallax Ray-Marching
        float distFromCenter = length(vUv - 0.5);
        float edgeMask = smoothstep(0.5, 0.22, distFromCenter);
        if (edgeMask <= 0.003) discard;

        vec2 parallaxDir = (V.xy / max(0.32, abs(V.z))) * uDepth * 0.18;
        const int STEPS = 5;
        vec3 accum = vec3(0.0);
        float weightSum = 0.0;

        for (int i = 0; i < STEPS; i++) {
          float t = (float(i) / float(STEPS - 1)) - 0.5;
          vec2 sampleUv = clamp(vUv + parallaxDir * t, 0.004, 0.996);
          vec3 sampleCol = texture2D(uMap, sampleUv).rgb;
          float lum = dot(sampleCol, vec3(0.299, 0.587, 0.114));
          float layerMatch = 1.0 - abs(t - (lum - 0.45) * 0.85);
          float w = max(0.08, layerMatch * layerMatch);
          accum += sampleCol * w;
          weightSum += w;
        }

        vec3 finalCol = accum / max(0.001, weightSum);
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
 */
export function createProceduralPlanetMaterial(params: {
  planetType: string;
  tempK: number;
  inHabitableZone: boolean;
  baseColor: string;
  seed: number;
}): THREE.ShaderMaterial {
  let mode = 0;
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
      ${GLSL_SAFE_MATH}

      varying vec3 vNormalWS;
      varying vec3 vPosOS;
      varying vec3 vViewDirWS;

      void main() {
        vPosOS = safeNorm(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = safeNorm(mat3(modelMatrix) * normal);
        vViewDirWS = safeNorm(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

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
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = safeNorm(vNormalWS);
        vec3 V = safeNorm(vViewDirWS);
        vec3 L = safeNorm(uSunDir);

        float ndotl = max(0.0, dot(N, L));
        float dayLight = smoothstep(-0.12, 0.85, dot(N, L)) * 0.92 + 0.08;
        float fresnel = safePow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);

        vec3 p = vPosOS;
        vec3 surfCol = uBaseColor;
        vec3 emissive = vec3(0.0);

        if (uMode > 2.5) {
          float n = fbm(p * 4.5 + vec3(uTime * 0.02));
          float cracks = smoothstep(0.46, 0.53, n);
          surfCol = mix(vec3(0.09, 0.06, 0.06), vec3(0.25, 0.12, 0.08), n);
          emissive = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.82, 0.25), smoothstep(0.5, 0.68, n)) * cracks * 1.35;
          emissive += vec3(0.95, 0.22, 0.02) * fresnel * 0.55;
        } else if (uMode > 1.5) {
          float turb = fbm(p * 3.8 + vec3(uTime * 0.03, 0.0, 0.0));
          float bands = sin(p.y * 18.0 + turb * 5.2);
          vec3 lightBand = mix(uBaseColor, vec3(0.98, 0.95, 0.88), 0.38);
          vec3 darkBand = uBaseColor * 0.58;
          surfCol = mix(darkBand, lightBand, bands * 0.5 + 0.5);
          emissive = uBaseColor * fresnel * 0.35;
        } else if (uMode > 0.5) {
          float elev = fbm(p * 3.6);
          float isLand = smoothstep(0.49, 0.525, elev);
          vec3 ocean = mix(vec3(0.04, 0.18, 0.46), vec3(0.08, 0.42, 0.68), smoothstep(0.32, 0.49, elev));
          vec3 land = mix(vec3(0.14, 0.44, 0.20), vec3(0.55, 0.46, 0.32), smoothstep(0.53, 0.75, elev));
          float ice = smoothstep(0.74, 0.88, abs(p.y) + elev * 0.14);
          surfCol = mix(ocean, land, isLand);
          surfCol = mix(surfCol, vec3(0.93, 0.96, 1.0), ice);

          vec3 H = safeNorm(L + V);
          float spec = safePow(max(0.0, dot(N, H)), 36.0) * (1.0 - isLand) * (1.0 - ice) * ndotl;
          surfCol += vec3(0.65, 0.82, 1.0) * spec * 0.55;

          float clouds = smoothstep(0.54, 0.72, fbm(p * 4.4 + vec3(uTime * 0.025, 0.0, uTime * 0.01)));
          surfCol = mix(surfCol, vec3(0.97, 0.99, 1.0), clouds * 0.62);

          emissive = vec3(0.24, 0.62, 1.0) * fresnel * (0.45 + 0.4 * ndotl);
        } else {
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
      ${GLSL_SAFE_MATH}

      varying vec3 vPosOS;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vPosOS = safeNorm(position);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = safeNorm(mat3(modelMatrix) * normal);
        vViewDirWS = safeNorm(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

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
        float ndotv = clamp(dot(safeNorm(vNormalWS), safeNorm(vViewDirWS)), 0.0, 1.0);
        float limb = safePow(ndotv, 0.45);
        vec3 core = mix(uColor * 0.78, vec3(1.0, 0.99, 0.94), gran * limb);
        vec3 rim = uColor * safePow(1.0 - ndotv, 2.2) * 1.25;
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
      uMaxSize: { value: params.maxSizePx ?? 32.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
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
      ${GLSL_SAFE_MATH}

      uniform float uSpikes;
      uniform float uGlobalOpacity;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vHighlight;

      void main() {
        if (vAlpha <= 0.005 || uGlobalOpacity <= 0.005) discard;
        #include <logdepthbuf_fragment>

        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float d = length(p);
        if (d > 1.0) discard;

        float core = exp(-d * d * 7.2);
        float halo = safePow(1.0 - d, 2.3) * 0.62;

        float spikes = 0.0;
        if (uSpikes > 0.5) {
          spikes = (exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.4) +
                    exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.4)) * 0.35;
        }

        float ring = 0.0;
        if (vHighlight > 0.5) {
          ring = smoothstep(0.11, 0.0, abs(d - 0.78)) * 0.95;
        }

        float intensity = core + halo + spikes + ring;
        vec3 col = mix(vColor, vec3(1.0), core * 0.68) + vec3(0.25, 0.95, 0.85) * ring * 0.5;
        gl_FragColor = vec4(col, clamp(intensity * vAlpha * uGlobalOpacity, 0.0, 1.0));
      }
    `,
  });
}

/**
 * Photorealistic 3D Earth Shader (100% NaN-Safe on Windows ANGLE/D3D11 + Mobile GPUs!):
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
      ${GLSL_SAFE_MATH}

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = safeNorm(mat3(modelMatrix) * normal);
        vViewDirWS = safeNorm(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

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

        vec3 N = safeNorm(vNormalWS);
        vec3 V = safeNorm(vViewDirWS);
        vec3 L = safeNorm(uSunDir);

        float cosTheta = dot(N, L);
        float dayFactor = smoothstep(-0.16, 0.24, cosTheta);
        float diffuse = max(0.05, smoothstep(-0.08, 0.92, cosTheta));

        vec3 dayTex = texture2D(uDayMap, vUv).rgb;
        vec3 nightTex = texture2D(uNightMap, vUv).rgb;

        vec2 cloudUv = vec2(fract(vUv.x + uTime * 0.0018), vUv.y);
        float cloudVal = texture2D(uCloudsMap, cloudUv).r;

        float oceanMask = clamp((dayTex.b - max(dayTex.r, dayTex.g) * 0.85) * 4.5, 0.0, 1.0) * (1.0 - cloudVal);
        vec3 H = safeNorm(L + V);
        float spec = safePow(max(0.0, dot(N, H)), 42.0) * oceanMask * max(0.0, cosTheta);

        vec3 litDay = mix(dayTex * 1.12, vec3(0.98, 0.99, 1.0), cloudVal * 0.76) * diffuse + vec3(0.75, 0.88, 1.0) * spec * 0.55;
        vec3 litNight = nightTex * vec3(1.35, 1.02, 0.68) * (1.0 - cloudVal * 0.6) * 1.25 + dayTex * 0.035;

        vec3 surface = mix(litNight, litDay, dayFactor);

        // Warm sunset twilight band (using ct * ct instead of pow(negative, 2.0)!)
        float ct = cosTheta * 5.5;
        float twilight = exp(-ct * ct) * 0.26;
        float fresnel = safePow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        vec3 atmoColor = mix(vec3(0.14, 0.42, 0.95), vec3(0.35, 0.76, 1.0), dayFactor);
        vec3 twilightColor = vec3(1.0, 0.44, 0.18) * twilight * fresnel * 1.6;

        gl_FragColor = vec4(surface + atmoColor * fresnel * (0.38 + 0.58 * dayFactor) + twilightColor, 1.0);
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
      ${GLSL_SAFE_MATH}

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWS = safeNorm(mat3(modelMatrix) * normal);
        vViewDirWS = safeNorm(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

      uniform sampler2D uMap;
      uniform vec3 uAtmoColor;
      uniform float uAtmoStrength;
      uniform vec3 uSunDir;

      varying vec2 vUv;
      varying vec3 vNormalWS;
      varying vec3 vViewDirWS;

      void main() {
        #include <logdepthbuf_fragment>

        vec3 N = safeNorm(vNormalWS);
        vec3 V = safeNorm(vViewDirWS);
        vec3 L = safeNorm(uSunDir);

        float diff = smoothstep(-0.18, 0.88, dot(N, L)) * 0.93 + 0.07;
        vec3 tex = texture2D(uMap, vUv).rgb * 1.08;
        float fresnel = safePow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);

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
          float cassiniGap = 1.0 - smoothstep(0.04, 0.0, abs(t - 0.64)) * 0.88;
          float enckeGap = 1.0 - smoothstep(0.015, 0.0, abs(t - 0.88)) * 0.7;
          float fineBands = 0.72 + 0.28 * sin(t * 95.0) * cos(t * 37.0);
          float edgeFade = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.93, t);
          vec3 ringCol = mix(uColor * 0.78, vec3(0.97, 0.93, 0.84), fineBands);
          gl_FragColor = vec4(ringCol, edgeFade * cassiniGap * enckeGap * 0.78);
        } else {
          float t = clamp((r - 1.45) / (1.88 - 1.45), 0.0, 1.0);
          float s = 0.5 + 0.5 * sin(t * 42.0);
          float ringlets = s * s;
          float edgeFade = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);
          gl_FragColor = vec4(uColor, edgeFade * ringlets * 0.35);
        }
      }
    `,
  });
}

/**
 * Single-Draw-Call Instanced Morphological Deep-Sky Simulation Shader (100% NaN-Safe!)
 * Renders 2,600+ real OpenNGC Galaxies, Emission Nebulae, Planetary Nebulae, SNRs & Star Clusters
 * in 1 GPU draw call using real catalog morphology:
 *   0 = Grand-Design / Flocculent Spiral Galaxy (Sa / Sb / Sc)
 *   1 = Barred Spiral Galaxy (SBa / SBb / SBc)
 *   2 = Elliptical / Lenticular Galaxy (E0–E7 / S0)
 *   3 = Turbulent H-II Emission / Reflection / Dark Nebula
 *   4 = Limb-Brightened Planetary Nebula / Supernova Remnant Bipolar Shell
 *   5 = Resolved Globular / Open Star Cluster
 */
export function createDeepSkySimulationMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uGlobalFade: { value: 1.0 },
      uPlateSolve: { value: 0.0 },
      uNarrowbandSHO: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_SAFE_MATH}

      attribute vec3 aCenterPos;
      attribute float aBaseRadius;
      attribute float aMorph;
      attribute vec3 aShape; // x = axisRatio, y = posAngleRad, z = seed
      attribute vec3 aPrimaryCol;
      attribute vec3 aSecondaryCol;
      attribute float aAlpha;
      attribute float aHighlight;

      uniform float uGlobalFade;

      varying vec2 vLocal;
      varying float vMorph;
      varying float vAxisRatio;
      varying float vSeed;
      varying vec3 vPrimaryCol;
      varying vec3 vSecondaryCol;
      varying float vAlpha;
      varying float vHighlight;

      void main() {
        vLocal = position.xy;
        vMorph = aMorph;
        vAxisRatio = aShape.x;
        vSeed = aShape.z;
        vPrimaryCol = aPrimaryCol;
        vSecondaryCol = aSecondaryCol;
        vAlpha = aAlpha * uGlobalFade;
        vHighlight = aHighlight;

        if (vAlpha <= 0.003) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec4 worldCenter = modelMatrix * vec4(aCenterPos, 1.0);
        float distCam = length(cameraPosition - worldCenter.xyz);

        // Camera-adaptive angular readability floor + true physical Light-Year scale on approach
        float minAngFactor = (aMorph < 2.5) ? 0.0095 : (aMorph < 4.5 ? 0.0135 : 0.0085);
        float minReadable = min(aBaseRadius * 14.0, distCam * minAngFactor * (1.0 + aHighlight * 0.45));
        float radius = max(aBaseRadius, minReadable);

        float ca = cos(aShape.y);
        float sa = sin(aShape.y);
        vec2 rotCorner = vec2(
          position.x * ca - position.y * sa,
          position.x * sa + position.y * ca
        );

        vec4 mvCenter = viewMatrix * worldCenter;
        mvCenter.xy += rotCorner * radius;
        gl_Position = projectionMatrix * mvCenter;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

      uniform float uTime;
      uniform float uPlateSolve;
      uniform float uNarrowbandSHO;

      varying vec2 vLocal;
      varying float vMorph;
      varying float vAxisRatio;
      varying float vSeed;
      varying vec3 vPrimaryCol;
      varying vec3 vSecondaryCol;
      varying float vAlpha;
      varying float vHighlight;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21) + vSeed * 0.173);
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm2(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
          v += amp * noise2(p);
          p = p * 2.07 + vec2(1.7, -1.3);
          amp *= 0.5;
        }
        return v;
      }

      void main() {
        if (vAlpha <= 0.003) discard;
        #include <logdepthbuf_fragment>

        vec2 p = vLocal;
        float rOuter = length(p);
        if (rOuter > 1.0) discard;

        float edgeVignette = smoothstep(1.0, 0.60, rOuter);
        vec3 col = vec3(0.0);
        float alpha = 0.0;

        if (vMorph < 1.5) {
          // 0 = Spiral Galaxy, 1 = Barred Spiral Galaxy (APOD Broadband LRGB + H-alpha Calibrated!)
          float ax = max(0.22, vAxisRatio);
          vec2 q = vec2(p.x, p.y / ax);
          float r = length(q);
          if (r > 1.02) discard;

          float theta = safeAtan(q.y, q.x);
          float spin = uTime * 0.05 * (fract(vSeed * 7.3) > 0.5 ? 1.0 : -1.0);
          float winding = 3.8 + fract(vSeed * 3.1) * 2.4;
          float logR = log(r + 0.082);

          float armPhase = 2.0 * (theta + spin) - winding * logR + vSeed * 6.28318;
          float armWave = 0.5 + 0.5 * cos(armPhase);
          float subArm = 0.5 + 0.5 * cos(armPhase * 2.0 + 1.1);
          float flocculence = fbm2(q * 6.8 + vec2(vSeed * 5.0));

          // Concave dark spiral dust lane absorption (signature of NASA APOD galaxy astrophotography!)
          float dustWave = 0.5 + 0.5 * cos(armPhase + 0.72);
          float dustAbsorb = 1.0 - 0.54 * safePow(dustWave, 3.0) * smoothstep(0.32, 0.78, flocculence) * smoothstep(0.06, 0.22, r) * exp(-r * 1.9);

          float arms = safePow(armWave, 2.3) * (0.68 + 0.58 * flocculence) + subArm * 0.20 * flocculence;
          float diskEnv = exp(-r * 3.25) * smoothstep(1.0, 0.70, r);
          float tidalHalo = exp(-safePow(r, 0.72) * 3.4) * smoothstep(1.0, 0.55, r) * 0.24;
          float bulge = exp(-r * r * 25.0);

          float bar = 0.0;
          if (vMorph > 0.5) {
            bar = exp(-q.y * q.y * 54.0) * exp(-q.x * q.x * 8.2) * 0.9;
          }

          // 656.3 nm H-alpha star-forming crimson/magenta knots studded along spiral arms
          float hiiKnots = smoothstep(0.60, 0.86, flocculence) * safePow(armWave, 3.1) * exp(-r * 2.3) * smoothstep(0.07, 0.22, r);

          vec3 coreCol = vec3(1.0, 0.92, 0.75);
          vec3 armCol = mix(vPrimaryCol, vec3(0.48, 0.79, 1.0), 0.52);
          vec3 hiiCol = mix(vec3(1.0, 0.25, 0.58), vec3(1.0, 0.62, 0.20), uNarrowbandSHO * 0.65);

          col = coreCol * (bulge * 1.42 + bar * 0.92 + tidalHalo * 0.65) +
                armCol * diskEnv * (0.26 + arms * 1.02) * dustAbsorb +
                hiiCol * hiiKnots * 1.12;

          alpha = clamp((bulge * 1.15 + bar * 0.68 + tidalHalo + diskEnv * (0.28 + arms * 0.72) * dustAbsorb) * edgeVignette, 0.0, 1.0);
        } else if (vMorph < 2.5) {
          // 2 = Elliptical / Lenticular Galaxy (E0-E7 / S0)
          float ax = max(0.32, vAxisRatio);
          vec2 q = vec2(p.x, p.y / ax);
          float r = length(q);
          if (r > 1.0) discard;

          float core = exp(-r * r * 22.0);
          float halo = exp(-safePow(r, 0.66) * 3.5) * smoothstep(1.0, 0.52, r);
          vec3 coreCol = vec3(1.0, 0.94, 0.80);
          col = mix(vPrimaryCol, coreCol, clamp(core * 1.2 + 0.28, 0.0, 1.0)) * (core * 1.22 + halo * 0.98);
          alpha = clamp((core + halo * 0.86) * edgeVignette, 0.0, 1.0);
        } else if (vMorph < 3.5) {
          // 3 = Turbulent H-II Emission / Reflection Nebula (APOD Broadband + Hubble SHO Narrowband!)
          vec2 warp = vec2(
            fbm2(p * 2.6 + vec2(vSeed * 3.7, uTime * 0.014)),
            fbm2(p * 2.6 + vec2(vSeed * 9.1 + 4.2, -uTime * 0.011))
          );
          float gas1 = fbm2(p * 3.5 + warp * 1.48);
          float gas2 = fbm2(p * 6.0 - warp * 1.18 + vec2(3.1));
          float radial = exp(-rOuter * rOuter * 2.5) * edgeVignette;

          // Bright photoionized shock ridge + dark Bok-globule molecular dust pillar
          float dustLane = smoothstep(0.32, 0.56, gas2);
          float ionRidge = exp(-abs(gas1 - 0.54) * 12.0) * dustLane;
          float oiiiCore = exp(-rOuter * rOuter * 5.8) * gas1;

          // Embedded newborn OB cluster stars with crisp 4-vane APOD Newtonian diffraction spikes
          vec2 starGrid = p * 7.2 + vec2(vSeed * 11.0);
          vec2 cellId = floor(starGrid);
          vec2 cellUv = fract(starGrid) - 0.5;
          float rnd = hash21(cellId);
          float obStar = 0.0;
          if (rnd > 0.77 && rOuter < 0.68) {
            vec2 dv = cellUv - (vec2(fract(rnd * 13.7), fract(rnd * 29.3)) - 0.5) * 0.48;
            float dStar = length(dv);
            float spikes = (exp(-abs(dv.x) * 32.0) * exp(-abs(dv.y) * 5.0) +
                            exp(-abs(dv.y) * 32.0) * exp(-abs(dv.x) * 5.0)) * 0.55;
            obStar = exp(-dStar * dStar * 105.0) * 1.25 + spikes;
          }

          vec3 priCol = mix(vPrimaryCol, vec3(0.96, 0.65, 0.16), uNarrowbandSHO * 0.85);
          vec3 secCol = mix(vSecondaryCol, vec3(0.08, 0.82, 0.98), uNarrowbandSHO * 0.85);
          vec3 ridgeCol = mix(vec3(1.0, 0.58, 0.72), vec3(1.0, 0.88, 0.48), uNarrowbandSHO);

          col = priCol * gas1 * radial * (0.42 + 0.88 * dustLane) +
                ridgeCol * ionRidge * radial * 0.55 +
                secCol * oiiiCore * 1.12 +
                vec3(0.90, 0.97, 1.0) * obStar * radial;
          alpha = clamp((gas1 * 0.96 + ionRidge * 0.35 + oiiiCore * 0.58 + obStar * 0.72) * radial, 0.0, 1.0);
        } else if (vMorph < 4.5) {
          // 4 = Limb-Brightened Planetary Nebula / Supernova Remnant Shock Shell
          float ax = max(0.55, vAxisRatio);
          vec2 q = vec2(p.x, p.y / ax);
          float r = length(q);
          if (r > 1.0) discard;

          float theta = safeAtan(q.y, q.x);
          float filaments = fbm2(vec2(cos(theta), sin(theta)) * 3.5 + q * 3.2 + vec2(vSeed * 4.0));
          float dr = (r - 0.52 + (filaments - 0.5) * 0.14) * 5.6;
          float shockRing = exp(-dr * dr) * (0.65 + 0.65 * filaments);
          float innerCavity = exp(-r * r * 5.5) * 0.48;
          float whiteDwarf = exp(-r * r * 140.0) * 1.25;

          vec3 priCol = mix(vPrimaryCol, vec3(0.12, 0.86, 0.96), uNarrowbandSHO * 0.6);
          vec3 secCol = mix(vSecondaryCol, vec3(0.98, 0.52, 0.18), uNarrowbandSHO * 0.7);

          col = priCol * shockRing * 1.18 +
                secCol * innerCavity +
                vec3(0.92, 0.98, 1.0) * whiteDwarf;
          alpha = clamp((shockRing * 0.92 + innerCavity * 0.55 + whiteDwarf * 0.85) * edgeVignette, 0.0, 1.0);
        } else {
          // 5 = Globular / Open Star Cluster
          float kingCore = exp(-rOuter * rOuter * 9.5);
          float halo = exp(-rOuter * 3.4) * edgeVignette;

          vec2 g1 = p * 13.0 + vec2(vSeed * 17.0);
          vec2 id1 = floor(g1);
          vec2 uv1 = fract(g1) - 0.5;
          float h1 = hash21(id1);
          float stars = 0.0;
          if (h1 > 0.42) {
            vec2 jitter = (vec2(fract(h1 * 19.1), fract(h1 * 37.7)) - 0.5) * 0.55;
            float ds = length(uv1 - jitter);
            stars += exp(-ds * ds * 65.0) * (0.5 + 0.8 * fract(h1 * 53.3));
          }

          vec3 starCol = mix(vPrimaryCol, vec3(0.75, 0.9, 1.0), fract(h1 * 11.3) * 0.55);
          col = vPrimaryCol * kingCore * 0.95 + starCol * stars * halo * 1.25;
          alpha = clamp((kingCore * 0.88 + halo * 0.25 + stars * halo * 0.85) * edgeVignette, 0.0, 1.0);
        }

        // NASA APOD / Astrometry.net 1px Plate-Solve Annotation Circle & Cardinal Crosshairs!
        if (uPlateSolve > 0.01) {
          float fwR = max(fwidth(rOuter), 0.008);
          float solveCircle = (1.0 - smoothstep(0.0, fwR * 1.35, abs(rOuter - 0.82))) * 0.72;
          float minAxis = min(abs(p.x), abs(p.y));
          float solveTicks = (1.0 - smoothstep(0.0, fwR * 1.25, minAxis)) *
                             step(0.73, rOuter) * step(rOuter, 0.91) * 0.82;
          float solveOverlay = max(solveCircle, solveTicks) * uPlateSolve;
          vec3 solveCol = (vMorph < 2.5) ? vec3(0.22, 0.88, 0.98) : (vMorph < 4.5 ? vec3(0.20, 0.95, 0.68) : vec3(0.98, 0.82, 0.28));
          col += solveCol * solveOverlay;
          alpha = max(alpha, solveOverlay * 0.78);
        }

        // Simulation Highlight Target Ring when matched by active filter
        if (vHighlight > 0.5) {
          float hRing = smoothstep(0.055, 0.0, abs(rOuter - 0.86));
          col += vec3(0.18, 0.92, 0.98) * hRing * 0.85;
          alpha = max(alpha, hRing * 0.78);
        }

        gl_FragColor = vec4(col, clamp(alpha * vAlpha, 0.0, 1.0));
      }
    `,
  });
}

/**
 * Multi-Scale Scientific Simulation Coordinate Grid Shader (100% NaN-Safe!)
 * Draws a razor-sharp, anti-aliased logarithmic polar astrometric reference grid
 * locked to true powers-of-10 physical cosmic distances (10^n Light-Years / AU / km)
 * with 15° radial azimuth bearings, cardinal J2000 axes, and smooth radial horizon fade.
 */
export function createSimulationGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSpanLy: { value: 1.0 },
      uOpacity: { value: 0.42 },
      uTime: { value: 0 },
      uPrimaryColor: { value: new THREE.Color('#22d3ee') },
      uSecondaryColor: { value: new THREE.Color('#3b82f6') },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vPlanePos;
      void main() {
        vPlanePos = position.xy * 2.0; // PlaneGeometry(1, 1) -> [-1, 1]
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

      uniform float uSpanLy;
      uniform float uOpacity;
      uniform float uTime;
      uniform vec3 uPrimaryColor;
      uniform vec3 uSecondaryColor;

      varying vec2 vPlanePos;

      void main() {
        if (uOpacity <= 0.004) discard;
        #include <logdepthbuf_fragment>

        float rNorm = length(vPlanePos);
        if (rNorm > 1.0 || rNorm < 0.008) discard;

        // Smooth inner & outer vignette so grid melts into deep space with zero hard border
        float outerFade = (1.0 - rNorm) * (1.0 - rNorm);
        float innerFade = smoothstep(0.008, 0.042, rNorm);
        float radialMask = outerFade * innerFade;

        // True physical radius in Light-Years around current floating-origin focus
        float rLy = max(rNorm * uSpanLy, 1e-13);
        float logR = log(rLy) * 0.4342944819; // log10(rLy)
        float fwLog = max(fwidth(logR), 1e-4);

        // Major decade range rings at every 10^n Light-Years
        float decDist = abs(fract(logR + 0.5) - 0.5);
        float majorRing = 1.0 - smoothstep(0.0, fwLog * 1.45, decDist);

        // Minor logarithmic sub-rings (2x..9x within each power-of-10 decade, seam-free analytical derivative)
        float mantissa = safePow(10.0, fract(logR)); // [1, 10)
        float fwMant = max(mantissa * 2.302585 * fwLog, 1e-3);
        float subDist = abs(fract(mantissa + 0.5) - 0.5);
        float minorFade = clamp(1.0 - fwMant * 0.55, 0.0, 1.0);
        float minorRing = (1.0 - smoothstep(0.0, fwMant * 1.25, subDist)) * minorFade * 0.34;

        // Seam-free 24 Radial Azimuth Bearings (every 15 deg) + 4 Cardinal J2000 Axes (every 90 deg)
        float angle = safeAtan(vPlanePos.y, vPlanePos.x);
        float fwAngle = max(length(fwidth(vPlanePos)) / max(rNorm, 1e-3), 1e-4);
        float spoke24 = (1.0 - smoothstep(0.0, 12.0 * fwAngle * 1.15, abs(sin(angle * 12.0)))) * 0.24;
        float cardinalAxis = (1.0 - smoothstep(0.0, 2.0 * fwAngle * 1.4, abs(sin(angle * 2.0)))) * 0.58;

        // Subtle sweeping astrometric radar pulse wave
        float pulsePos = fract(uTime * 0.055);
        float dp = (rNorm - pulsePos) * 14.0;
        float scannerWave = exp(-dp * dp) * 0.09;

        float lineIntensity = max(max(majorRing * 0.85, minorRing), max(cardinalAxis, spoke24)) + scannerWave;
        if (lineIntensity * radialMask * uOpacity < 0.004) discard;

        vec3 col = mix(uSecondaryColor, uPrimaryColor, clamp(majorRing + cardinalAxis * 0.8, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(lineIntensity * radialMask * uOpacity, 0.0, 1.0));
      }
    `,
  });
}

/**
 * Animated 3D Scientific Target Lock-On Reticle Shader (100% NaN-Safe!)
 * Renders rotating astrometric degree ticks, corner lock brackets, and telemetry ring around selected target.
 */
export function createTargetReticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#22d3ee') },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy * 2.0;
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
      ${GLSL_SAFE_MATH}

      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vLocal;

      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vLocal;
        vec2 ap = abs(p);
        float r = length(p);
        if (r > 1.15) discard;

        // Rotating segmented astrometric outer ring
        float ang = safeAtan(p.y, p.x) + uTime * 0.45;
        float dash = step(0.35, fract(ang * (12.0 / (2.0 * PI))));
        float ringOuter = smoothstep(0.032, 0.0, abs(r - 0.78)) * dash * 0.78;

        // Counter-rotating inner vernier ring
        float ang2 = safeAtan(p.y, p.x) - uTime * 0.7;
        float dash2 = step(0.65, fract(ang2 * (24.0 / (2.0 * PI))));
        float ringInner = smoothstep(0.022, 0.0, abs(r - 0.62)) * dash2 * 0.55;

        // Corner [ + ] framing brackets
        float cornerBox = max(ap.x, ap.y);
        float bracketBand = smoothstep(0.032, 0.0, abs(cornerBox - 0.94));
        float cornerMask = step(0.66, ap.x) * step(0.66, ap.y) * bracketBand * 0.92;
        float cornerArm = (
          smoothstep(0.026, 0.0, abs(ap.x - 0.94)) * step(0.68, ap.y) * step(ap.y, 0.96) +
          smoothstep(0.026, 0.0, abs(ap.y - 0.94)) * step(0.68, ap.x) * step(ap.x, 0.96)
        ) * 0.92;

        float alpha = clamp(ringOuter + ringInner + max(cornerMask, cornerArm), 0.0, 1.0);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}

/**
 * Directional Comet-Tail Orbital Trajectory Shader (100% NaN-Safe!)
 * Shows live orbital velocity direction around planets & moons with a bright leading head
 * right at the body's current position tapering smoothly around the 360° ellipse.
 */
export function createDirectionalOrbitMaterial(colorHex: string, baseOpacity = 0.72): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uBodyDir: { value: new THREE.Vector3(1, 0, 0) },
      uOpacity: { value: baseOpacity },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_SAFE_MATH}
      varying vec3 vDirOS;
      void main() {
        vDirOS = safeNorm(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_SAFE_MATH}

      uniform vec3 uColor;
      uniform vec3 uBodyDir;
      uniform float uOpacity;
      varying vec3 vDirOS;

      void main() {
        if (uOpacity <= 0.005) discard;
        #include <logdepthbuf_fragment>

        // Compute prograde J2000 counter-clockwise angle behind uBodyDir in XZ equatorial/ecliptic plane
        vec2 b = safeNorm(vec3(uBodyDir.x, 0.0, uBodyDir.z)).xz;
        vec2 p = safeNorm(vec3(vDirOS.x, 0.0, vDirOS.z)).xz;
        float angB = safeAtan(-b.y, b.x);
        float angP = safeAtan(-p.y, p.x);
        // Prograde motion increases RA (which is -Z in Three.js right-handed basis), so behind body is angB - angP mod 2PI
        float behind = fract((angB - angP) / (2.0 * PI));
        // trail = 1.0 right at the planet's live position, tapering smoothly along its wake!
        float wake = safePow(1.0 - behind, 2.6);
        float alpha = (0.14 + 0.86 * wake) * uOpacity;
        vec3 col = mix(uColor, vec3(0.88, 0.97, 1.0), wake * 0.42);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });
}
