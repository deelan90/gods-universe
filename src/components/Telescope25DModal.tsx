import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Sparkles, Globe2, Layers, RotateCw } from 'lucide-react';
import type { TelescopeImage } from '../types/universe';
import { createTelescope25DMaterial } from '../engine/shaders';
import { resolveWebGLTextureUrls } from '../utils/nasaImagesClient';

interface Props {
  image: TelescopeImage | null;
  defaultSpherical?: boolean;
  onClose: () => void;
}

export const Telescope25DModal: React.FC<Props> = ({
  image,
  defaultSpherical = true,
  onClose,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const [sphericalMode, setSphericalMode] = useState(defaultSpherical);
  const [depthStrength, setDepthStrength] = useState(defaultSpherical ? 0.32 : 0.28);
  const [autoOrbit, setAutoOrbit] = useState(true);

  useEffect(() => {
    setSphericalMode(defaultSpherical);
    setDepthStrength(defaultSpherical ? 0.32 : 0.28);
  }, [image, defaultSpherical]);

  useEffect(() => {
    if (!image || !mountRef.current) return;
    const container = mountRef.current;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.05,
      100
    );
    camera.position.set(0, 0, 2.15);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.1;
    controls.maxDistance = 4.2;
    // Constrain polar/azimuth angles so perspective warp always stays realistic & artifact-free!
    controls.minPolarAngle = Math.PI * 0.24;
    controls.maxPolarAngle = Math.PI * 0.76;
    controls.minAzimuthAngle = -Math.PI * 0.32;
    controls.maxAzimuthAngle = Math.PI * 0.32;
    controlsRef.current = controls;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const { primaryUrl, fallbackUrl } = resolveWebGLTextureUrls(image.imageUrl);

    const mat = createTelescope25DMaterial({
      texture: new THREE.Texture(),
      spherical: defaultSpherical,
      depthStrength: defaultSpherical ? 0.32 : 0.28,
      tintColor: '#60a5fa',
    });
    // Use NormalBlending inside modal for crisp true-color planetary/nebula contrast
    mat.blending = THREE.NormalBlending;
    matRef.current = mat;

    loader.load(
      primaryUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.uniforms.uMap.value = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        loader.load(fallbackUrl, (tex2) => {
          tex2.colorSpace = THREE.SRGBColorSpace;
          mat.uniforms.uMap.value = tex2;
          mat.needsUpdate = true;
        });
      }
    );

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 1.48, 64, 64), mat);
    scene.add(mesh);

    let raf = 0;
    const t0 = performance.now();
    const renderLoop = () => {
      raf = requestAnimationFrame(renderLoop);
      const t = (performance.now() - t0) * 0.001;
      mat.uniforms.uTime.value = t;
      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [image, defaultSpherical]);

  useEffect(() => {
    if (matRef.current) {
      matRef.current.uniforms.uSpherical.value = sphericalMode ? 1.0 : 0.0;
      matRef.current.uniforms.uDepth.value = depthStrength;
    }
  }, [sphericalMode, depthStrength]);

  useEffect(() => {
    if (!controlsRef.current) return;
    let raf = 0;
    let angle = 0;
    const step = () => {
      if (autoOrbit && controlsRef.current) {
        angle += 0.018;
        const r = controlsRef.current.object.position.length();
        controlsRef.current.object.position.x = Math.sin(angle) * r * 0.36;
        controlsRef.current.object.position.y = Math.cos(angle * 0.7) * r * 0.2;
        controlsRef.current.object.position.z = Math.sqrt(
          Math.max(0.4, r * r - controlsRef.current.object.position.x ** 2 - controlsRef.current.object.position.y ** 2)
        );
      }
      raf = requestAnimationFrame(step);
    };
    if (autoOrbit) step();
    return () => cancelAnimationFrame(raf);
  }, [autoOrbit, image]);

  if (!image) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6">
      <div className="relative flex flex-col w-full max-w-4xl h-[86vh] rounded-2xl border border-cyan-500/30 bg-[#040916]/95 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/70">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-cyan-400">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>2.5D Telescope Perspective Synthesis // {image.telescope}</span>
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-white truncate mt-0.5">
              {image.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
            title="Close 3D Inspector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive 3D Perspective Viewport */}
        <div
          ref={mountRef}
          onPointerDown={() => setAutoOrbit(false)}
          className="relative flex-1 w-full cursor-grab active:cursor-grabbing bg-[radial-gradient(circle_at_center,#0b1730_0%,#02050d_75%)]"
        >
          <div className="pointer-events-none absolute top-3 left-3 rounded-lg bg-slate-950/75 border border-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300">
            Drag to orbit perspective • Scroll/Pinch to zoom
          </div>
        </div>

        {/* Controls & Description Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/90 space-y-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSphericalMode(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  sphericalMode
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Globe2 className="w-3.5 h-3.5" />
                3D Spherical Planet Lensing
              </button>
              <button
                onClick={() => setSphericalMode(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  !sphericalMode
                    ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Volumetric Depth-Parallax Relief
              </button>
              <button
                onClick={() => setAutoOrbit((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  autoOrbit
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <RotateCw className={`w-3.5 h-3.5 ${autoOrbit ? 'animate-spin' : ''}`} />
                Auto-Sway Perspective
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
              <span>3D Relief Depth:</span>
              <input
                type="range"
                min={0.05}
                max={0.6}
                step={0.02}
                value={depthStrength}
                onChange={(e) => setDepthStrength(parseFloat(e.target.value))}
                className="w-28 accent-cyan-400"
              />
              <span className="w-9 text-right text-cyan-300">{Math.round(depthStrength * 100)}%</span>
            </div>
          </div>

          {image.description && (
            <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
              {image.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
