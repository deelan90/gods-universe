import type { TelescopeImage } from '../types/universe';

export const IS_LOCAL_DEV_HOST =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

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

  if (IS_LOCAL_DEV_HOST) {
    return {
      primaryUrl: `/api/image-proxy?url=${encodeURIComponent(httpsUrl)}`,
      fallbackUrl: wsrvUrl,
    };
  }
  // On GitHub Pages / static hosts, use resized CORS-enabled CDN first with direct NASA CDN fallback
  return {
    primaryUrl: wsrvUrl,
    fallbackUrl: httpsUrl,
  };
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
    const textBlob = `${title} ${desc} ${keywords}`.toLowerCase();

    let telescope = center;
    if (
      textBlob.includes('webb') ||
      textBlob.includes('jwst') ||
      textBlob.includes('nircam') ||
      textBlob.includes('miri')
    ) {
      telescope = 'JWST';
    } else if (textBlob.includes('hubble') || textBlob.includes('hst')) {
      telescope = 'Hubble';
    } else if (textBlob.includes('chandra')) {
      telescope = 'Chandra X-Ray';
    } else if (textBlob.includes('spitzer')) {
      telescope = 'Spitzer IR';
    } else if (textBlob.includes('tess')) {
      telescope = 'TESS';
    } else if (textBlob.includes('kepler')) {
      telescope = 'Kepler';
    } else if (textBlob.includes('cassini')) {
      telescope = 'Cassini';
    } else if (textBlob.includes('juno')) {
      telescope = 'Juno';
    } else if (textBlob.includes('voyager')) {
      telescope = 'Voyager';
    } else if (textBlob.includes('new horizons')) {
      telescope = 'New Horizons';
    } else if (
      textBlob.includes('perseverance') ||
      textBlob.includes('curiosity') ||
      textBlob.includes('reconnaissance')
    ) {
      telescope = 'Mars Exploration';
    }

    let popularityScore = 50;
    if (
      ['JWST', 'Hubble', 'Cassini', 'Juno', 'New Horizons', 'Voyager', 'Chandra X-Ray'].includes(
        telescope
      )
    ) {
      popularityScore += 30;
    }
    if (nasaId.startsWith('PIA') || nasaId.toLowerCase().startsWith('stsci')) {
      popularityScore += 20;
    }
    if (contextTag === 'Direct / Primary Target') {
      popularityScore += 25;
    }
    if (
      textBlob.includes('portrait') ||
      textBlob.includes('mosaic') ||
      textBlob.includes('deep field') ||
      textBlob.includes('full')
    ) {
      popularityScore += 12;
    }
    if (
      textBlob.includes('chart') ||
      textBlob.includes('graph') ||
      textBlob.includes('diagram') ||
      textBlob.includes('spectrum')
    ) {
      popularityScore -= 25;
    }

    parsed.push({
      id: nasaId,
      title,
      description: desc.slice(0, 420),
      dateCreated: String(d.date_created || '2020-01-01T00:00:00Z'),
      center,
      telescope,
      imageUrl: link.href.replace(/^http:\/\//i, 'https://'),
      contextTag,
      popularityScore,
    });
  }

  return parsed;
}

export async function fetchTelescopeGallery(
  primaryQuery: string,
  fallbackQuery = ''
): Promise<TelescopeImage[]> {
  if (IS_LOCAL_DEV_HOST) {
    try {
      const params = new URLSearchParams({ q: primaryQuery, fallback: fallbackQuery });
      const res = await fetch(`/api/images?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.items)) return data.items;
      }
    } catch {
      // Fall through to direct public NASA API
    }
  }

  const queryDirect = async (q: string, tag: string): Promise<TelescopeImage[]> => {
    const r = await fetch(
      `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=20`
    );
    if (!r.ok) return [];
    const j = await r.json();
    return parseNasaCollectionItems(j?.collection?.items || [], q, tag);
  };

  const items = await queryDirect(primaryQuery, 'Direct / Primary Target');
  if (items.length < 5 && fallbackQuery && fallbackQuery.toLowerCase() !== primaryQuery.toLowerCase()) {
    const extra = await queryDirect(fallbackQuery, 'Host System / Mission Archive');
    const seen = new Set(items.map((i) => i.id));
    for (const ex of extra) {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        items.push(ex);
      }
    }
  }
  return items;
}
