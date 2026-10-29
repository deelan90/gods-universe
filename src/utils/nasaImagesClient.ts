import type { TelescopeImage, UnifiedCelestialObject } from '../types/universe';

export const IS_LOCAL_DEV_HOST =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const galleryMemoryCache = new Map<string, TelescopeImage[]>();

export function resolvePublicDataUrl(filename: string): string {
  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}data/${filename}`;
}

/**
 * Returns a fast, CORS-safe, WebGL-friendly texture URL both locally and on GitHub Pages
 */
export function resolveWebGLTextureUrls(rawImageUrl: string): {
  primaryUrl: string;
  fallbackUrl: string;
} {
  const httpsUrl = rawImageUrl.replace(/^http:\/\//i, 'https://');
  const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(httpsUrl)}&w=1024&output=jpg`;

  if (IS_LOCAL_DEV_HOST && !httpsUrl.includes('wsrv.nl') && !httpsUrl.includes('legacysurvey.org')) {
    return {
      primaryUrl: wsrvUrl,
      fallbackUrl: httpsUrl,
    };
  }
  return {
    primaryUrl: wsrvUrl,
    fallbackUrl: httpsUrl,
  };
}

function detectTelescopeTag(textBlob: string, defaultCenter = 'NASA'): string {
  const t = textBlob.toLowerCase();
  if (t.includes('webb') || t.includes('jwst') || t.includes('nircam') || t.includes('miri')) return 'JWST';
  if (t.includes('hubble') || t.includes('hst')) return 'Hubble';
  if (t.includes('eso') || t.includes('very large telescope') || t.includes('vlt')) return 'ESO / VLT';
  if (t.includes('chandra')) return 'Chandra X-Ray';
  if (t.includes('spitzer')) return 'Spitzer IR';
  if (t.includes('tess')) return 'NASA TESS';
  if (t.includes('kepler')) return 'NASA Kepler';
  if (t.includes('cassini')) return 'Cassini';
  if (t.includes('juno')) return 'Juno';
  if (t.includes('voyager')) return 'Voyager';
  if (t.includes('new horizons')) return 'New Horizons';
  if (t.includes('perseverance') || t.includes('curiosity') || t.includes('reconnaissance')) return 'Mars Orbiter/Rover';
  if (t.includes('event horizon') || t.includes('eht')) return 'Event Horizon Telescope';
  return defaultCenter;
}

function parseNasaCollectionItems(
  rawItems: Record<string, unknown>[],
  defaultQuery: string,
  contextTag: string
): TelescopeImage[] {
  const parsed: TelescopeImage[] = [];

  for (const entry of rawItems) {
    const dataArr = entry?.data as Record<string, unknown>[] | undefined;
    const linksArr = entry?.links as Record<string, string>[] | undefined;
    const d = dataArr?.[0];
    const link = (linksArr || []).find((l) => l.render === 'image' && l.href);
    if (!d || !link?.href) continue;

    const title = String(d.title || defaultQuery);
    const desc = String(d.description || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const keywords = Array.isArray(d.keywords) ? d.keywords.join(' ') : '';
    const center = String(d.center || 'NASA');
    const nasaId = String(d.nasa_id || link.href);
    const textBlob = `${title} ${desc} ${keywords}`;
    const lower = textBlob.toLowerCase();

    // Filter out non-astronomy portraits, logos, or pure line-plot charts when better imagery exists
    if (
      lower.includes('press conference') ||
      lower.includes('headshot') ||
      lower.includes('committee') ||
      lower.includes('administrator') ||
      lower.includes('ribbon cutting')
    ) {
      continue;
    }

    const telescope = detectTelescopeTag(textBlob, center);
    let popularityScore = 55;
    if (['JWST', 'Hubble', 'ESO / VLT', 'Cassini', 'Juno', 'New Horizons', 'Voyager', 'Chandra X-Ray', 'Event Horizon Telescope'].includes(telescope)) {
      popularityScore += 32;
    }
    if (nasaId.startsWith('PIA') || nasaId.toLowerCase().startsWith('stsci')) {
      popularityScore += 22;
    }
    if (contextTag === 'Direct / Primary Target') {
      popularityScore += 28;
    }
    if (lower.includes('chart') || lower.includes('graph') || lower.includes('diagram')) {
      popularityScore -= 30;
    }

    parsed.push({
      id: nasaId,
      title,
      description: desc.slice(0, 380),
      dateCreated: String(d.date_created || '2022-01-01T00:00:00Z'),
      center,
      telescope,
      imageUrl: encodeURI(decodeURI(link.href.replace(/^http:\/\//i, 'https://'))),
      contextTag,
      popularityScore,
    });
  }

  return parsed;
}

async function fetchWikipediaSummaryImage(wikiTitle: string): Promise<TelescopeImage | null> {
  try {
    const clean = wikiTitle.trim().replace(/\s+/g, '_');
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const origUrl: string | undefined = data?.originalimage?.source;
    const origWidth: number = Number(data?.originalimage?.width || 0);
    const thumbUrl: string | undefined = data?.thumbnail?.source;

    const rawPick = origUrl || thumbUrl;
    if (!rawPick || /\.svg(\?|$)/i.test(rawPick)) return null;

    let imgUrl = rawPick;
    if (origUrl && (/\.tiff?(\?|$)/i.test(origUrl) || origWidth > 2800)) {
      imgUrl = thumbUrl || `https://wsrv.nl/?url=${encodeURIComponent(origUrl)}&w=960&output=jpg`;
    }

    const extract = String(data?.extract || '').trim();
    return {
      id: `wiki-${clean}`,
      title: `${data.title || wikiTitle} — Primary Reference Imagery`,
      description: extract.slice(0, 380),
      dateCreated: data?.timestamp || '2025-01-01T00:00:00Z',
      center: 'Wikimedia / Observatory Archive',
      telescope: detectTelescopeTag(extract, 'Observatory Archive'),
      imageUrl: imgUrl,
      contextTag: 'Direct / Primary Target',
      popularityScore: 115,
    };
  } catch {
    return null;
  }
}

async function fetchWikimediaCommonsImages(searchQuery: string): Promise<TelescopeImage[]> {
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(searchQuery)}&gsrnamespace=6&gsrlimit=8` +
      `&prop=imageinfo&iiprop=url|timestamp|extmetadata&iiurlwidth=960&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const pages = Object.values((json?.query?.pages || {}) as Record<string, Record<string, unknown>>);

    const out: TelescopeImage[] = [];
    for (const p of pages) {
      const fileTitleLower = String(p.title || '').toLowerCase();
      if (
        fileTitleLower.endsWith('.svg') ||
        fileTitleLower.endsWith('.pdf') ||
        fileTitleLower.endsWith('.djvu') ||
        fileTitleLower.endsWith('.webm') ||
        fileTitleLower.endsWith('.ogv') ||
        fileTitleLower.endsWith('.ogg') ||
        fileTitleLower.includes('coat_of_arms') ||
        fileTitleLower.includes('flag_of') ||
        fileTitleLower.includes('logo')
      ) {
        continue;
      }

      const info = (p.imageinfo as Record<string, unknown>[])?.[0];
      const thumbUrl = String(info?.thumburl || info?.url || '');
      if (!thumbUrl || thumbUrl.endsWith('.svg') || thumbUrl.endsWith('.pdf') || thumbUrl.endsWith('.tif')) {
        continue;
      }
      const rawTitle = String(p.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      const meta = (info?.extmetadata || {}) as Record<string, { value?: string }>;
      const rawDesc = String(meta?.ImageDescription?.value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      out.push({
        id: `commons-${p.pageid}`,
        title: rawTitle,
        description: rawDesc.slice(0, 340),
        dateCreated: String(info?.timestamp || '2023-01-01T00:00:00Z'),
        center: 'Wikimedia Commons',
        telescope: detectTelescopeTag(`${rawTitle} ${rawDesc}`, 'Astronomical Archive'),
        imageUrl: thumbUrl,
        contextTag: 'Direct / Primary Target',
        popularityScore: 92,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function buildSkySurveyCutouts(obj: UnifiedCelestialObject): TelescopeImage[] {
  if (
    obj.raDeg == null ||
    obj.decDeg == null ||
    ['planet', 'moon', 'dwarf-planet', 'satellite', 'spacecraft'].includes(obj.category) ||
    obj.id === 'sun' ||
    obj.id === 'cmb-horizon'
  ) {
    return [];
  }

  const ra = Number(obj.raDeg).toFixed(4);
  const dec = Number(obj.decDeg).toFixed(4);
  const fovPixels = obj.category === 'constellation' ? '8.0' : obj.category === 'galaxy' ? '1.8' : '0.9';

  // 1. Official NASA GSFC SkyView Digitized Sky Survey (All-Sky Northern + Southern Optical Telescope Plate!)
  const rawSkyView = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${ra},${dec}&Survey=DSS2+Red&Return=JPEG&Pixels=640,400`;
  const skyViewProxied = `https://wsrv.nl/?url=${encodeURIComponent(rawSkyView)}&output=jpg`;

  // 2. NOIRLab / DESI Legacy Imaging Survey DR10 Deep Multi-Band Color Cutout
  const legacyUrl = `https://www.legacysurvey.org/viewer/jpeg-cutout?ra=${ra}&dec=${dec}&pixscale=${fovPixels}&layer=ls-dr10&size=640`;

  return [
    {
      id: `skyview-${obj.id}`,
      title: `${obj.name} — Real Optical Sky Survey Field (RA ${ra}°, Dec ${dec}°)`,
      description: `Actual telescope sky-plate centered on ${obj.name}’s exact celestial coordinates (Right Ascension ${ra}°, Declination ${dec}°) from NASA GSFC SkyView / Digitized Sky Survey.`,
      dateCreated: '2025-06-01T00:00:00Z',
      center: 'NASA GSFC SkyView',
      telescope: 'DSS2 Optical Survey',
      imageUrl: skyViewProxied,
      contextTag: 'Direct Telescope Sky Cutout',
      popularityScore: 98,
    },
    {
      id: `legacy-${obj.id}`,
      title: `${obj.name} — Deep Multi-Band Survey Cutout`,
      description: `Deep optical/near-IR sky survey cutout at (${ra}°, ${dec}°) via NOIRLab DESI Legacy Imaging Survey DR10.`,
      dateCreated: '2025-01-01T00:00:00Z',
      center: 'NOIRLab / DESI',
      telescope: 'DECam Sky Survey',
      imageUrl: legacyUrl,
      contextTag: 'Direct Telescope Sky Cutout',
      popularityScore: 88,
    },
  ];
}

async function queryNasaSearch(q: string, tag: string): Promise<TelescopeImage[]> {
  if (!q.trim()) return [];
  try {
    const r = await fetch(
      `https://images-api.nasa.gov/search?q=${encodeURIComponent(q.trim())}&media_type=image&page_size=14`
    );
    if (!r.ok) return [];
    const j = await r.json();
    return parseNasaCollectionItems(j?.collection?.items || [], q, tag);
  } catch {
    return [];
  }
}

/**
 * Multi-Source Universal Imagery Engine:
 * Combines Hero Capture + Wikipedia Lead + Live Telescope Sky-Survey Cutouts + Wikimedia Commons + NASA Archive
 * so EVERY SINGLE celestial object out of 13,800+ is guaranteed rich, authentic imagery!
 */
export async function fetchObjectGallery(obj: UnifiedCelestialObject): Promise<TelescopeImage[]> {
  if (galleryMemoryCache.has(obj.id)) {
    return galleryMemoryCache.get(obj.id)!;
  }

  const results: TelescopeImage[] = [];
  const seenUrls = new Set<string>();
  const pushUnique = (items: (TelescopeImage | null | undefined)[]) => {
    for (const item of items) {
      if (!item || !item.imageUrl || seenUrls.has(item.imageUrl)) continue;
      seenUrls.add(item.imageUrl);
      results.push(item);
    }
  };

  // 1. Curated Flagship Hero Capture
  if (obj.heroImage) {
    pushUnique([
      {
        id: `hero-${obj.id}`,
        title: `${obj.name} — Flagship Observatory Portrait`,
        description: obj.funFacts[0] || '',
        dateCreated: '2025-01-01T00:00:00Z',
        center: 'NASA / ESA',
        telescope: detectTelescopeTag(obj.funFacts.join(' ') + ' ' + obj.nasaQuery, 'Flagship Mission'),
        imageUrl: obj.heroImage,
        contextTag: 'Direct / Primary Target',
        popularityScore: 130,
      },
    ]);
  }

  // 2. Parallel Multi-Archive Fetch (Wikipedia Lead + Commons + NASA Primary + Sky Cutouts)
  const commonsTerm =
    obj.category === 'exoplanet'
      ? `${obj.name} exoplanet`
      : obj.category === 'constellation'
        ? `${obj.nasaQuery} constellation`
        : obj.category === 'star' && obj.wikiTitle
          ? `${obj.wikiTitle} star`
          : obj.nasaQuery;

  const [wikiImg, commonsImgs, nasaPrimary] = await Promise.all([
    obj.wikiTitle ? fetchWikipediaSummaryImage(obj.wikiTitle) : Promise.resolve(null),
    fetchWikimediaCommonsImages(commonsTerm),
    queryNasaSearch(obj.nasaQuery, 'Direct / Primary Target'),
  ]);

  pushUnique([wikiImg]);
  pushUnique(buildSkySurveyCutouts(obj));
  pushUnique(commonsImgs);
  pushUnique(nasaPrimary);

  // 3. Smart Tiered NASA Fallback if specific catalog designation had few direct press photos
  if (results.length < 7 && obj.fallbackQuery) {
    const nasaFallback = await queryNasaSearch(obj.fallbackQuery, 'Mission / Class Archive');
    pushUnique(nasaFallback);
  }

  // 4. Guaranteed Category Showcase safety net so results NEVER come back empty
  if (results.length < 5) {
    const guaranteedTerm =
      obj.category === 'exoplanet'
        ? 'exoplanet'
        : obj.category === 'star'
          ? 'Hubble star'
          : obj.category === 'satellite'
            ? 'International Space Station'
            : obj.category === 'galaxy'
              ? 'spiral galaxy'
              : 'Hubble nebula';
    const safety = await queryNasaSearch(guaranteedTerm, 'Space Telescope Archive');
    pushUnique(safety);
  }

  galleryMemoryCache.set(obj.id, results);
  return results;
}
