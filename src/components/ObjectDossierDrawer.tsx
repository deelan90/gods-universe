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
import { fetchObjectGallery } from '../utils/nasaImagesClient';

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

export const ObjectDossierDrawer: React.FC<Props> = React.memo(
  ({
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
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
    const [loadingImages, setLoadingImages] = useState(false);
    const [galleryTab, setGalleryTab] = useState<'popular' | 'recent' | 'all'>('popular');

    useEffect(() => {
      if (!object) return;
      let cancelled = false;
      setFailedIds(new Set());
      setLoadingImages(true);

      // Show instant hero image if available while archives load in parallel
      if (object.heroImage) {
        setImages([
          {
            id: `hero-${object.id}`,
            title: `${object.name} — Flagship Observatory Portrait`,
            description: object.funFacts[0] || '',
            dateCreated: '2025-01-01T00:00:00Z',
            center: 'NASA / ESA',
            telescope: 'Flagship Mission',
            imageUrl: object.heroImage,
            contextTag: 'Direct / Primary Target',
            popularityScore: 130,
          },
        ]);
      } else {
        setImages([]);
      }

      fetchObjectGallery(object)
        .then((fetched) => {
          if (!cancelled) {
            setImages(fetched);
          }
        })
        .catch(() => {
          // Keep existing hero image if present
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingImages(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [object]);

    const markImageFailed = (id: string) => {
      setFailedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    };

    const validImages = useMemo(
      () => images.filter((img) => !failedIds.has(img.id)),
      [images, failedIds]
    );

    const sortedImages = useMemo(() => {
      const copy = [...validImages];
      if (galleryTab === 'popular') {
        return copy.sort((a, b) => b.popularityScore - a.popularityScore);
      }
      if (galleryTab === 'recent') {
        return copy.sort(
          (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
        );
      }
      return copy;
    }, [validImages, galleryTab]);

    if (!object) return null;

    const distInfo =
      objectPosLy && object.id !== originObject?.id
        ? formatCosmicDistance(distanceBetweenPosLy(originPosLy, objectPosLy).distLy)
        : null;

    const isSphericalCandidate = [
      'planet',
      'moon',
      'dwarf-planet',
      'exoplanet',
      'star',
      'black-hole',
    ].includes(object.category);

    const leadBannerImage = validImages[0] || null;

    return (
      <aside className="pointer-events-auto animate-panel-in fixed bottom-0 inset-x-0 sm:inset-auto sm:top-16 sm:right-3.5 sm:bottom-24 z-30 w-full sm:w-[24.5rem] max-h-[72vh] sm:max-h-none flex flex-col rounded-t-2xl sm:rounded-2xl glass-panel overflow-hidden text-xs">
        {/* Cinematic Hero Image Header */}
        <div className="relative h-36 sm:h-40 w-full shrink-0 overflow-hidden bg-slate-950 border-b border-white/10">
          {leadBannerImage ? (
            <img
              key={leadBannerImage.id}
              src={leadBannerImage.imageUrl}
              alt={leadBannerImage.title}
              onError={() => markImageFailed(leadBannerImage.id)}
              className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
            />
          ) : (
            <div className="w-full h-full shimmer-bg" />
          )}

          {/* Smooth Cinematic Gradient Vignette */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#050a18] via-[#050a18]/45 to-black/25" />

          {/* Top Bar Over Hero: Category Pill + 3D Perspective Quick Launch + Close */}
          <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase font-semibold border backdrop-blur-md"
                style={{
                  borderColor: `${object.color}88`,
                  backgroundColor: 'rgba(4, 9, 22, 0.72)',
                  color: object.color,
                }}
              >
                {object.category}
              </span>
              {object.planetType && (
                <span className="px-2 py-0.5 rounded-md bg-slate-950/75 border border-white/10 backdrop-blur-md text-[10px] font-mono text-slate-200">
                  {object.planetType}
                </span>
              )}
              {object.inHabitableZone && (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/25 border border-emerald-400/50 backdrop-blur-md text-[10px] font-mono text-emerald-200">
                  HABITABLE
                </span>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-900 border border-white/15 text-slate-300 hover:text-white backdrop-blur-md transition shrink-0"
              title="Close Dossier"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Bottom Title Overlay inside Hero */}
          <div className="absolute bottom-2.5 inset-x-3.5 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold text-white leading-tight drop-shadow truncate">
                {object.name}
              </h2>
              <p className="text-[11px] text-slate-300/90 truncate mt-0.5">{object.subtitle}</p>
            </div>
            {leadBannerImage && (
              <button
                onClick={() => onOpen25DImage(leadBannerImage, isSphericalCandidate)}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-[11px] shadow-lg transition"
                title="Inspect this photograph in interactive 3D perspective"
              >
                <Box className="w-3.5 h-3.5" />
                <span>3D View</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Navigation Action Bar */}
        <div className="px-3.5 py-2.5 border-b border-white/10 bg-slate-950/50 grid grid-cols-2 gap-2 shrink-0">
          <button
            onClick={() => onFlyTo(object.id)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 font-medium transition"
          >
            <Compass className="w-3.5 h-3.5" />
            Fly To Object
          </button>
          <button
            onClick={() => onSetAsOrigin(object.id)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-200 font-medium transition"
            title="Set this celestial body as the reference origin for measuring distances"
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            Measure From Here
          </button>
        </div>

        {/* Scrollable Science & Gallery Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {/* Distance Banner from Active Origin (Default: Earth) */}
          {distInfo && (
            <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-500/12 to-cyan-500/10 border border-emerald-400/25 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/90">
                  Distance from {originObject?.name || 'Earth'}
                </div>
                <div className="font-display text-base font-bold text-white mt-0.5">
                  {distInfo.primary}
                </div>
                <div className="text-[10px] font-mono text-slate-400">{distInfo.secondary}</div>
              </div>
              <Compass className="w-5 h-5 text-emerald-400/75 shrink-0" />
            </div>
          )}

          {/* Physical Telemetry Grid */}
          {(object.earthRadii || object.solarRadii || object.tempK || object.orbPeriodDays) && (
            <div className="grid grid-cols-2 gap-2">
              {object.earthRadii != null && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                  <div className="text-[10px] font-mono text-slate-400">SIZE VS EARTH</div>
                  <div className="text-sm font-mono font-semibold text-white mt-0.5">
                    {object.earthRadii}× R⊕
                  </div>
                </div>
              )}
              {object.massEarths != null && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
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
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                  <div className="text-[10px] font-mono text-slate-400">STAR RADIUS</div>
                  <div className="text-sm font-mono font-semibold text-amber-300 mt-0.5">
                    {object.solarRadii}× R☉
                  </div>
                </div>
              )}
              {object.tempK != null && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                  <div className="text-[10px] font-mono text-slate-400">TEMPERATURE</div>
                  <div className="text-sm font-mono font-semibold text-orange-300 mt-0.5">
                    {object.tempK.toLocaleString()} K ({Math.round(object.tempK - 273.15)}°C)
                  </div>
                </div>
              )}
              {object.orbPeriodDays != null && object.orbPeriodDays > 0 && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                  <div className="text-[10px] font-mono text-slate-400">ORBITAL YEAR</div>
                  <div className="text-sm font-mono font-semibold text-cyan-300 mt-0.5">
                    {object.orbPeriodDays < 10
                      ? `${object.orbPeriodDays.toFixed(2)} days`
                      : `${Math.round(object.orbPeriodDays).toLocaleString()} days`}
                  </div>
                </div>
              )}
              {object.discYear != null && (
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07]">
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
            <div className="space-y-1.5">
              {object.funFacts.map((fact, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-slate-200 leading-relaxed"
                >
                  {fact}
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Archive Telescope & Observatory Image Gallery */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-300">
                <Camera className="w-3.5 h-3.5" />
                <span>Observatory & Sky Survey Imagery</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {validImages.length} captures
              </span>
            </div>

            {/* Filter Tabs: Popular | Most Recent | All */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-950/80 border border-white/10">
              <button
                onClick={() => setGalleryTab('popular')}
                className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium transition ${
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
                className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium transition ${
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
                className={`py-1.5 rounded-lg text-[11px] font-medium transition ${
                  galleryTab === 'all'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({validImages.length})
              </button>
            </div>

            {loadingImages && validImages.length <= 1 && (
              <div className="py-5 flex items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Fetching NASA, SkyView DSS2 & Observatory Plates...</span>
              </div>
            )}

            <div className="space-y-2.5">
              {sortedImages.slice(0, 12).map((img) => (
                <div
                  key={img.id}
                  className="group rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-cyan-400/50 overflow-hidden transition"
                >
                  <div className="relative aspect-video bg-slate-950 overflow-hidden">
                    <img
                      src={img.imageUrl}
                      alt={img.title}
                      loading="lazy"
                      onError={() => markImageFailed(img.id)}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/25" />
                    <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1 pr-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-950/85 border border-white/15 backdrop-blur-md text-[10px] font-mono text-cyan-300">
                        {img.telescope}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-950/75 text-[9px] font-mono text-slate-300">
                        {img.dateCreated.slice(0, 10)}
                      </span>
                    </div>
                    <button
                      onClick={() => onOpen25DImage(img, isSphericalCandidate)}
                      className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-400/95 hover:bg-cyan-300 text-slate-950 font-semibold text-[11px] shadow-lg transition"
                    >
                      <Box className="w-3.5 h-3.5" />
                      3D Perspective
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
          </div>
        </div>
      </aside>
    );
  }
);
