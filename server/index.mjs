import express from 'express';
import cors from 'cors';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CACHE_DIR,
  DEFAULT_SYNC_INTERVAL_HOURS,
  PUBLIC_DATA_DIR,
  ROOT_DIR,
  runUniverseSync,
} from './syncData.mjs';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const serveStatic = process.argv.includes('--serve-static');

app.use(cors());
app.use(express.json());

let isSyncing = false;
let syncIntervalHours = DEFAULT_SYNC_INTERVAL_HOURS;

async function getManifest() {
  try {
    const raw = await fsp.readFile(path.join(PUBLIC_DATA_DIR, 'syncManifest.json'), 'utf-8');
    const data = JSON.parse(raw);
    if (data.syncIntervalHours) syncIntervalHours = data.syncIntervalHours;
    return data;
  } catch {
    return null;
  }
}

async function triggerSyncIfNeeded(force = false) {
  if (isSyncing) return { inProgress: true, manifest: await getManifest() };
  isSyncing = true;
  try {
    const result = await runUniverseSync({ force, syncIntervalHours });
    return { inProgress: false, ...result };
  } finally {
    isSyncing = false;
  }
}

// GET /api/status — Continual update status, last sync timestamp, counts & new discoveries
app.get('/api/status', async (_req, res) => {
  const manifest = await getManifest();
  res.json({
    ok: true,
    isSyncing,
    syncIntervalHours,
    manifest,
  });
});

// POST /api/sync — Trigger manual check or update continual check cadence (e.g., every 72h / 3 days)
app.post('/api/sync', async (req, res) => {
  if (req.body?.syncIntervalHours) {
    const hrs = Number(req.body.syncIntervalHours);
    if (Number.isFinite(hrs) && hrs >= 6 && hrs <= 720) {
      syncIntervalHours = hrs;
    }
  }
  const force = req.body?.force !== false;
  try {
    const result = await triggerSyncIfNeeded(force);
    res.json({ ok: true, isSyncing, syncIntervalHours, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/images — Fetch popular, recent & all telescope captures from NASA Image & Video Library
app.get('/api/images', async (req, res) => {
  const primaryQuery = String(req.query.q || '').trim();
  const fallbackQuery = String(req.query.fallback || '').trim();
  if (!primaryQuery) {
    return res.json({ ok: true, items: [] });
  }

  const imgCacheDir = path.join(CACHE_DIR, 'images');
  await fsp.mkdir(imgCacheDir, { recursive: true });
  const cacheKey = crypto
    .createHash('md5')
    .update(`${primaryQuery}|${fallbackQuery}`)
    .digest('hex');
  const cacheFile = path.join(imgCacheDir, `${cacheKey}.json`);

  try {
    const stat = await fsp.stat(cacheFile);
    if (Date.now() - stat.mtimeMs < 72 * 3600 * 1000) {
      const cached = JSON.parse(await fsp.readFile(cacheFile, 'utf-8'));
      return res.json({ ok: true, cached: true, items: cached });
    }
  } catch {
    // Cache miss
  }

  const fetchNasaSearch = async (q, contextTag = 'Direct / Primary Target') => {
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=20`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'GodsUniverseObservatory/1.0' },
    });
    if (!r.ok) return [];
    const json = await r.json();
    const rawItems = json?.collection?.items || [];

    const parsed = [];
    for (const entry of rawItems) {
      const d = entry?.data?.[0];
      const link = (entry?.links || []).find((l) => l.render === 'image' && l.href);
      if (!d || !link?.href) continue;

      const title = d.title || q;
      const desc = (d.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const keywords = d.keywords || [];
      const textBlob = `${title} ${desc} ${keywords.join(' ')}`.toLowerCase();

      // Identify flagship telescope / mission
      let telescope = d.center || 'NASA';
      if (textBlob.includes('webb') || textBlob.includes('jwst') || textBlob.includes('nircam') || textBlob.includes('miri')) {
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
      } else if (textBlob.includes('perseverance') || textBlob.includes('curiosity') || textBlob.includes('reconnaissance')) {
        telescope = 'Mars Exploration';
      }

      // Popularity / Iconic score heuristic based on flagship observatories,PIA/STScI IDs, and rich captions
      let popularityScore = 50;
      if (['JWST', 'Hubble', 'Cassini', 'Juno', 'New Horizons', 'Voyager', 'Chandra X-Ray'].includes(telescope)) {
        popularityScore += 30;
      }
      if ((d.nasa_id || '').startsWith('PIA') || (d.nasa_id || '').toLowerCase().startsWith('stsci')) {
        popularityScore += 20;
      }
      if (contextTag === 'Direct / Primary Target') {
        popularityScore += 25;
      }
      if (textBlob.includes('portrait') || textBlob.includes('mosaic') || textBlob.includes('deep field') || textBlob.includes('full')) {
        popularityScore += 12;
      }
      if (textBlob.includes('chart') || textBlob.includes('graph') || textBlob.includes('diagram') || textBlob.includes('spectrum')) {
        popularityScore -= 25;
      }

      parsed.push({
        id: d.nasa_id || link.href,
        title,
        description: desc.slice(0, 420),
        dateCreated: d.date_created || '2020-01-01T00:00:00Z',
        center: d.center || 'NASA',
        telescope,
        imageUrl: link.href.replace(/^http:\/\//i, 'https://'),
        contextTag,
        popularityScore,
      });
    }
    return parsed;
  };

  try {
    let items = await fetchNasaSearch(primaryQuery, 'Direct / Primary Target');
    if (items.length < 5 && fallbackQuery && fallbackQuery.toLowerCase() !== primaryQuery.toLowerCase()) {
      const extra = await fetchNasaSearch(fallbackQuery, 'Host System / Mission Archive');
      const seen = new Set(items.map((i) => i.id));
      for (const ex of extra) {
        if (!seen.has(ex.id)) {
          seen.add(ex.id);
          items.push(ex);
        }
      }
    }
    await fsp.writeFile(cacheFile, JSON.stringify(items));
    res.json({ ok: true, cached: false, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, items: [] });
  }
});

// GET /api/image-proxy — CORS-safe proxy for WebGL 2.5D Depth-Parallax telescope shaders
const ALLOWED_IMAGE_HOSTS = [
  'images-assets.nasa.gov',
  'photojournal.jpl.nasa.gov',
  'www.nasa.gov',
  'science.nasa.gov',
  'stsci-opo.org',
  'cdn.esawebb.org',
  'cdn.esahubble.org',
  'upload.wikimedia.org',
];

app.get('/api/image-proxy', async (req, res) => {
  const targetUrl = String(req.query.url || '');
  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_IMAGE_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
      return res.status(403).send('Host not permitted');
    }
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': 'GodsUniverseObservatory/1.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).send('Upstream image error');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    const arrayBuf = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch {
    res.status(400).send('Invalid image URL');
  }
});

if (serveStatic) {
  const distDir = path.join(ROOT_DIR, 'dist');
  app.use(express.static(distDir));
  app.use('/data', express.static(PUBLIC_DATA_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[God's Universe API] Listening on http://localhost:${PORT}`);
  // Check data freshness on startup and every hour for continual 72-hour auto-updates
  triggerSyncIfNeeded(false).catch((e) => console.warn('[AutoSync] Startup check warning:', e.message));
  setInterval(() => {
    triggerSyncIfNeeded(false).catch((e) => console.warn('[AutoSync] Periodic check warning:', e.message));
  }, 3600 * 1000);
});
