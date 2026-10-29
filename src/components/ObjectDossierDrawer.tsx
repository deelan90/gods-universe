import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Compass,
  MapPin,
  Sparkles,
  Camera,
  Box,
  Loader2,
  Flame,
  Calendar,
} from 'lucide-react';
import type { TelescopeImage, UnifiedCelestialObject } from '../types/universe';
import { distanceBetweenPosLy, formatCosmicDistance } from '../utils/astronomy';
import { fetchTelescopeGallery } from '../utils/nasaImagesClient';

interface Props {
  object: UnifiedCelestialObject | null;
  originObject: UnifiedCelestialObject | undefined;
  objectPosLy: [number, number, number] | null;
  originPosLy: [number, number, number];
  onClose: () => void;
  onFlyTo: (id: string) => void;
  onSetAsOrigin: (id: string) => void;
  onOpen25DImage: (img: TelescopeImage, sphericalDefault: boolean) => void;
}

export const ObjectDossierDrawer: React.FC<Props> = ({
  object,
  originObject,
  objectPosLy,
  originPosLy,
  onClose,
  onFlyTo,
  onSetAsOrigin,
  onOpen25DImage,
}) => {
  const [images, setImages] = useState<TelescopeImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [galleryTab, setGalleryTab] = useState<'popular' | 'recent' | 'all'>('popular');

  useEffect(() => {
    if (!object) return;
    let cancelled = false;
    setLoadingImages(true);

    const loadGallery = async () => {
      try {
        let fetched = await fetchTelescopeGallery(
          object.nasaQuery,
          object.fallbackQuery || ''
        );
        if (cancelled) return;

        // Prepend hero telescope capture if present and not already duplicated
        if (object.heroImage && !fetched.some((i) => i.imageUrl === object.heroImage)) {
          fetched = [
            {
              id: `hero-${object.id}`,
              title: `${object.name} — Flagship Observatory Capture`,
              description: object.funFacts[0] || '',
              dateCreated: '2024-01-01T00:00:00Z',
              center: 'NASA / ESA',
              telescope: 'Flagship Observatory',
              imageUrl: object.heroImage,
              contextTag: 'Direct / Primary Target',
              popularityScore: 120,
            },
            ...fetched,
          ];
        }
        setImages(fetched);
      } catch {
        if (!cancelled) setImages([]);
      } finally {
        if (!cancelled) setLoadingImages(false);
      }
    };

    loadGallery();
    return () => {
      cancelled = true;
    };
  }, [object]);

  const sortedImages = useMemo(() => {
    const copy = [...images];
    if (galleryTab === 'popular') {
      return copy.sort((a, b) => b.popularityScore - a.popularityScore);
    }
    if (galleryTab === 'recent') {
      return copy.sort(
        (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
      );
    }
    return copy;
  }, [images, galleryTab]);

  if (!object) return null;

  const distInfo =
    objectPosLy && object.id !== originObject?.id
      ? formatCosmicDistance(distanceBetweenPosLy(originPosLy, objectPosLy).distLy)
      : null;

  const isSphericalCandidate = ['planet', 'moon', 'dwarf-planet', 'exoplanet', 'star', 'black-hole'].includes(
    object.category
  );

  return (
    <aside className="pointer-events-auto fixed bottom-0 inset-x-0 sm:inset-auto sm:top-16 sm:right-3.5 sm:bottom-24 z-30 w-full sm:w-96 max-h-[68vh] sm:max-h-none flex flex-col rounded-t-2xl sm:rounded-2xl bg-slate-950/92 border border-slate-800/90 backdrop-blur-xl shadow-2xl overflow-hidden text-xs">
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 bg-gradient-to-r from-slate-900/90 to-slate-950/90">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span
                className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border"
                style={{
                  borderColor: `${object.color}66`,
                  backgroundColor: `${object.color}22`,
                  color: object.color,
                }}
              >
                {object.category}
              </span>
              {object.planetType && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-200">
                  {object.planetType}
                </span>
              )}
              {object.inHabitableZone && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-mono text-emerald-300">
                  HABITABLE ZONE
                </span>
              )}
              {object.isRecent && (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-mono text-amber-300">
                  NEW DISCOVERY
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white leading-tight">
              {object.name}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">{object.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => onFlyTo(object.id)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 font-medium transition"
          >
            <Compass className="w-3.5 h-3.5" />
            Fly To 3D Object
          </button>
          <button
            onClick={() => onSetAsOrigin(object.id)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium transition"
            title="Set this celestial body as the reference origin for measuring distances"
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            Measure From Here
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Distance Banner from Active Origin (Default: Earth) */}
        {distInfo && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase text-emerald-300/80">
                Distance from {originObject?.name || 'Earth'}
              </div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {distInfo.primary}
              </div>
              <div className="text-[10px] font-mono text-slate-400">{distInfo.secondary}</div>
            </div>
            <Compass className="w-5 h-5 text-emerald-400/70 shrink-0" />
          </div>
        )}

        {/* Physical Telemetry Grid */}
        {(object.earthRadii || object.solarRadii || object.tempK || object.orbPeriodDays) && (
          <div className="grid grid-cols-2 gap-2">
            {object.earthRadii != null && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">SIZE VS EARTH</div>
                <div className="text-sm font-mono font-semibold text-white mt-0.5">
                  {object.earthRadii}× R⊕
                </div>
              </div>
            )}
            {object.massEarths != null && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">MASS VS EARTH</div>
                <div className="text-sm font-mono font-semibold text-white mt-0.5">
                  {object.massEarths >= 100
                    ? Math.round(object.massEarths).toLocaleString()
                    : object.massEarths}
                  × M⊕
                </div>
              </div>
            )}
            {object.solarRadii != null && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">STAR RADIUS</div>
                <div className="text-sm font-mono font-semibold text-amber-300 mt-0.5">
                  {object.solarRadii}× R☉
                </div>
              </div>
            )}
            {object.tempK != null && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">TEMPERATURE</div>
                <div className="text-sm font-mono font-semibold text-orange-300 mt-0.5">
                  {object.tempK.toLocaleString()} K ({Math.round(object.tempK - 273.15)}°C)
                </div>
              </div>
            )}
            {object.orbPeriodDays != null && object.orbPeriodDays > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">ORBITAL YEAR</div>
                <div className="text-sm font-mono font-semibold text-cyan-300 mt-0.5">
                  {object.orbPeriodDays < 10
                    ? `${object.orbPeriodDays.toFixed(2)} days`
                    : `${Math.round(object.orbPeriodDays).toLocaleString()} days`}
                </div>
              </div>
            )}
            {object.discYear != null && (
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400">DISCOVERED</div>
                <div className="text-sm font-mono font-semibold text-purple-300 mt-0.5 truncate">
                  {object.discYear} • {object.discFacility}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Fun Facts Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Fun Facts & Science Dossier</span>
          </div>
          <div className="space-y-2">
            {object.funFacts.map((fact, i) => (
              <div
                key={i}
                className="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800/80 text-slate-200 leading-relaxed"
              >
                {fact}
              </div>
            ))}
          </div>
        </div>

        {/* Telescope Image Gallery (Popular / Most Recent / All) + 2.5D Perspective Synthesis Trigger */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300">
              <Camera className="w-3.5 h-3.5" />
              <span>Telescope Imagery</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              {images.length} captures
            </span>
          </div>

          {/* Filter Tabs: Popular | Most Recent | All */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800">
            <button
              onClick={() => setGalleryTab('popular')}
              className={`flex items-center justify-center gap-1 py-1 rounded-lg text-[11px] font-medium transition ${
                galleryTab === 'popular'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Flame className="w-3 h-3 text-amber-400" />
              Popular
            </button>
            <button
              onClick={() => setGalleryTab('recent')}
              className={`flex items-center justify-center gap-1 py-1 rounded-lg text-[11px] font-medium transition ${
                galleryTab === 'recent'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Calendar className="w-3 h-3 text-emerald-400" />
              Recent
            </button>
            <button
              onClick={() => setGalleryTab('all')}
              className={`py-1 rounded-lg text-[11px] font-medium transition ${
                galleryTab === 'all'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({images.length})
            </button>
          </div>

          {loadingImages ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              <span>Querying NASA / JWST / Hubble Archives...</span>
            </div>
          ) : sortedImages.length === 0 ? (
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 text-center">
              No archived photographs found for this object yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortedImages.slice(0, 10).map((img) => (
                <div
                  key={img.id}
                  className="group rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-cyan-400/50 overflow-hidden transition"
                >
                  <div className="relative aspect-video bg-slate-950 overflow-hidden">
                    <img
                      src={img.imageUrl}
                      alt={img.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                    <div className="absolute top-2 left-2 flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-slate-950/85 border border-slate-700 text-[10px] font-mono text-cyan-300">
                        {img.telescope}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-950/75 text-[9px] font-mono text-slate-300">
                        {img.dateCreated.slice(0, 10)}
                      </span>
                    </div>
                    <button
                      onClick={() => onOpen25DImage(img, isSphericalCandidate)}
                      className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/90 hover:bg-cyan-400 text-slate-950 font-semibold text-[11px] shadow-lg transition"
                    >
                      <Box className="w-3.5 h-3.5" />
                      View in 3D Perspective
                    </button>
                  </div>
                  <div className="p-2.5">
                    <div className="font-medium text-slate-100 line-clamp-1">{img.title}</div>
                    {img.description && (
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                        {img.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
