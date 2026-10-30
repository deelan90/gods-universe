import type { ApodEntry, TelescopeImage, UnifiedCelestialObject } from '../types/universe';
import { resolvePublicDataUrl } from './nasaImagesClient';

function decodeEntities(str = ''): string {
  return String(str)
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;|&#8217;/g, '’')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWpApodItems(items: Record<string, unknown>[]): ApodEntry[] {
  const out: ApodEntry[] = [];
  for (const it of items) {
    const titleObj = it.title as { rendered?: string } | undefined;
    const rawTitle = decodeEntities((titleObj?.rendered || '').replace(/<[^>]+>/g, ''));
    if (!rawTitle) continue;
    const cleanTitle = rawTitle.replace(/^APOD:\s*[^–—-]+[–—-]\s*/i, '').trim() || rawTitle;

    const embedded = it._embedded as Record<string, Record<string, unknown>[]> | undefined;
    const mediaObj = embedded?.['wp:featuredmedia']?.[0];
    let imageUrl = String(mediaObj?.source_url || '');

    const contentObj = it.content as { rendered?: string } | undefined;
    const contentHtml = String(contentObj?.rendered || '');
    if (!imageUrl) {
      const mImg = contentHtml.match(/<img[^>]+src="([^"]+)"/i);
      if (mImg && !mImg[1].includes('logo')) imageUrl = mImg[1];
    }
    if (!imageUrl) continue;

    const expIdx = contentHtml.indexOf('Explanation:');
    const creditIdx = contentHtml.search(/Image Credit|Credit\s*&|Video Credit/i);
    let credit = 'NASA / APOD';
    if (creditIdx >= 0 && (expIdx < 0 || creditIdx < expIdx)) {
      const slice = contentHtml.slice(creditIdx, expIdx > creditIdx ? expIdx : creditIdx + 260);
      credit = decodeEntities(slice.replace(/<[^>]+>/g, ' '))
        .replace(/^(Image Credit\s*(&\s*Copyright)?|Credit|Video Credit)\s*:?\s*/i, '')
        .slice(0, 120);
    }

    const excerptObj = it.excerpt as { rendered?: string } | undefined;
    const expRaw = expIdx >= 0 ? contentHtml.slice(expIdx + 12) : String(excerptObj?.rendered || '');
    const tomorrowIdx = expRaw.search(/Tomorrow['’]s picture:|<hr/i);
    const explanation = decodeEntities(
      (tomorrowIdx > 0 ? expRaw.slice(0, tomorrowIdx) : expRaw)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
    ).slice(0, 920);

    out.push({
      id: `apod-${String(it.id || out.length)}`,
      date: String(it.date || '').slice(0, 10),
      title: cleanTitle,
      fullHeading: rawTitle,
      explanation,
      credit: credit || 'NASA / APOD',
      imageUrl: imageUrl.replace(/^http:\/\//i, 'https://'),
      articleUrl: String(it.link || 'https://science.nasa.gov/apod/'),
    });
  }
  return out;
}

/**
 * Loads cached `public/data/apod.json` immediately and merges live updates from `science.nasa.gov` WP-JSON API.
 */
export async function fetchNasaApodFeed(): Promise<ApodEntry[]> {
  let cached: ApodEntry[] = [];
  try {
    const r = await fetch(resolvePublicDataUrl('apod.json'));
    if (r.ok) {
      cached = await r.json();
    }
  } catch {
    // Ignore local fallback error
  }

  try {
    const liveRes = await fetch(
      'https://science.nasa.gov/wp-json/wp/v2/image-article?search=APOD&per_page=14&_embed'
    );
    if (liveRes.ok) {
      const json = await liveRes.json();
      if (Array.isArray(json)) {
        const liveParsed = parseWpApodItems(json);
        if (liveParsed.length > 0) {
          const seenDates = new Set(liveParsed.map((e) => e.date));
          const merged = [
            ...liveParsed,
            ...cached.filter((c) => !seenDates.has(c.date)),
          ];
          return merged.slice(0, 20);
        }
      }
    }
  } catch {
    // Offline or rate-limited; use synced apod.json
  }

  return cached;
}

/**
 * Automatically plate-matches a NASA APOD title & astronomer explanation to a 3D object in our 18,400+ catalog!
 */
export function matchApodToCatalog(
  entry: ApodEntry,
  catalogById: Map<string, UnifiedCelestialObject>,
  searchableObjects: UnifiedCelestialObject[]
): UnifiedCelestialObject | null {
  if (!entry || catalogById.size === 0) return null;

  const titleText = entry.title;
  const fullBlob = `${entry.title} ${entry.explanation.slice(0, 420)}`;
  const lowerTitle = titleText.toLowerCase();
  const lowerBlob = fullBlob.toLowerCase();

  // 1. Direct NGC / IC catalog code match (e.g., NGC 2237, IC 434)
  const ngcMatch = fullBlob.match(/\b(NGC|IC)\s?0*(\d{1,4})\b/i);
  if (ngcMatch) {
    const prefix = ngcMatch[1].toLowerCase();
    const num = ngcMatch[2].padStart(4, '0');
    const dsoId = `dso-${prefix}${num}`;
    if (catalogById.has(dsoId)) return catalogById.get(dsoId)!;
  }

  // 2. Direct Messier catalog code match (e.g., M42, M31, M81, M51, M87)
  const messierLandmarkMap: Record<string, string> = {
    M1: 'crab-nebula',
    M16: 'pillars-of-creation',
    M31: 'andromeda',
    M33: 'triangulum',
    M42: 'orion-nebula',
    M45: 'pleiades',
    M51: 'whirlpool-galaxy',
    M57: 'ring-nebula',
    M87: 'm87-black-hole',
    M104: 'sombrero-galaxy',
  };
  const mMatch = fullBlob.match(/\b(?:Messier\s+|M)(\d{1,3})\b/i);
  if (mMatch) {
    const mCode = `M${parseInt(mMatch[1], 10)}`;
    if (messierLandmarkMap[mCode] && catalogById.has(messierLandmarkMap[mCode])) {
      return catalogById.get(messierLandmarkMap[mCode])!;
    }
    const foundMessier = searchableObjects.find((o) =>
      o.name.includes(`(${mCode})`) || o.name.startsWith(`${mCode} `)
    );
    if (foundMessier) return foundMessier;
  }

  // 3. Keyword-to-ID canonical mapping (checked in Title first, then Explanation)
  const keywordPairs: [RegExp, string][] = [
    [/\bandromeda\b/i, 'andromeda'],
    [/\borion nebula|great nebula in orion\b/i, 'orion-nebula'],
    [/\bcarina nebula\b/i, 'carina-nebula'],
    [/\bpillars of creation|eagle nebula\b/i, 'pillars-of-creation'],
    [/\bcrab nebula\b/i, 'crab-nebula'],
    [/\bring nebula\b/i, 'ring-nebula'],
    [/\bhelix nebula\b/i, 'helix-nebula'],
    [/\bpleiades|seven sisters\b/i, 'pleiades'],
    [/\bwhirlpool galaxy\b/i, 'whirlpool-galaxy'],
    [/\bsombrero galaxy\b/i, 'sombrero-galaxy'],
    [/\bcartwheel galaxy\b/i, 'cartwheel-galaxy'],
    [/\bstephan['’]?s quintet\b/i, 'stephans-quintet'],
    [/\bcentaurus a\b/i, 'centaurus-a'],
    [/\bperseus cluster\b/i, 'perseus-cluster'],
    [/\bcoma cluster\b/i, 'coma-cluster'],
    [/\bbullet cluster\b/i, 'bullet-cluster'],
    [/\bsmacs 0723\b/i, 'smacs-0723'],
    [/\brosette nebula\b/i, 'dso-ngc2237'],
    [/\bhorsehead nebula\b/i, 'dso-ic0434'],
    [/\blagoon nebula\b/i, 'dso-ngc6523'],
    [/\bveil nebula\b/i, 'dso-ngc6992'],
    [/\bbode['’]?s galaxy\b/i, 'dso-ngc3031'],
    [/\bvenus\b/i, 'venus'],
    [/\bjupiter|ganymede|europa|callisto|\bio\b/i, 'jupiter'],
    [/\bsaturn|titan|enceladus|cassini\b/i, 'saturn'],
    [/\bmars|perseverance|curiosity|olympus mons\b/i, 'mars'],
    [/\bmercury\b/i, 'mercury'],
    [/\buranus\b/i, 'uranus'],
    [/\bneptune|triton\b/i, 'neptune'],
    [/\bpluto\b/i, 'pluto'],
    [/\bnoctilucent|aurora|northern lights|southern lights|milky way over|over sweden|earth['’]?s atmosphere\b/i, 'earth'],
    [/\bcrescent moon|full moon|lunar eclipse|tycho|mare\b/i, 'moon'],
    [/\bsolar flare|sunspot|coronal mass|solar corona\b/i, 'sun'],
    [/\bspace station|\biss\b/i, 'sat-25544'],
    [/\bjames webb|\bjwst\b/i, 'jwst'],
  ];

  for (const [rx, id] of keywordPairs) {
    if (rx.test(lowerTitle) && catalogById.has(id)) {
      return catalogById.get(id)!;
    }
  }
  for (const [rx, id] of keywordPairs) {
    if (rx.test(lowerBlob) && catalogById.has(id)) {
      return catalogById.get(id)!;
    }
  }

  return null;
}

export function apodToTelescopeImage(entry: ApodEntry): TelescopeImage {
  return {
    id: entry.id,
    title: `${entry.title} (NASA APOD • ${entry.date})`,
    description: entry.explanation,
    dateCreated: `${entry.date}T00:00:00Z`,
    center: entry.credit || 'NASA APOD',
    telescope: 'NASA APOD Observatory',
    imageUrl: `https://wsrv.nl/?url=${encodeURIComponent(entry.imageUrl)}&w=1280&output=jpg`,
    contextTag: 'NASA Astronomy Picture of the Day',
    popularityScore: 120,
  };
}
