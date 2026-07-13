import crmWorker from '../crm/worker.js';

const FALLBACK_REVIEWS = {
  branches: [
    {
      key: 'powai',
      name: 'Powai',
      rating: 4.8,
      reviewCount: 353,
      mapsUrl: 'https://maps.google.com/?cid=15912189656107260684',
    },
    {
      key: 'wadala',
      name: 'Wadala',
      rating: 4.9,
      reviewCount: 122,
      mapsUrl: 'https://maps.google.com/?cid=11252018354724842123',
    },
    {
      key: 'borivali',
      name: 'Borivali',
      rating: 4.9,
      reviewCount: 68,
      mapsUrl: 'https://maps.google.com/?cid=9215377768450868907',
    },
    {
      key: 'thane',
      name: 'Thane',
      rating: 4.9,
      reviewCount: 172,
      mapsUrl: 'https://maps.google.com/?cid=15727590347717143769',
    },
  ],
  summary: { averageRating: 4.9, totalReviews: 715 },
  updatedAt: '2026-07-12T15:29:57.266Z',
};

const BRANCH_QUERIES = [
  { key: 'powai', name: 'Powai', query: 'Opal Radiant Studio Powai Mumbai' },
  { key: 'wadala', name: 'Wadala', query: 'Opal Radiant Studio Wadala Mumbai' },
  { key: 'borivali', name: 'Borivali', query: 'Opal Radiant Studio Borivali Mumbai' },
  { key: 'thane', name: 'Thane', query: 'Opal Radiant Studio Thane' },
];

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.pathname === '/api/reviews') {
    if (context.request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }
    if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    return handleReviews(context);
  }

  if (
    url.pathname === '/api/lead'
    || url.pathname.startsWith('/api/dashboard')
    || url.pathname === '/dashboard'
    || url.pathname === '/dashboard/'
  ) {
    return crmWorker.fetch(context.request, context.env);
  }

  return context.next();
}

async function handleReviews(context) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/reviews-cache-v2', context.request.url), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let payload = FALLBACK_REVIEWS;
  if (context.env.GOOGLE_MAPS_API_KEY) {
    try {
      const branches = await Promise.all(BRANCH_QUERIES.map((branch) => fetchBranch(branch, context.env.GOOGLE_MAPS_API_KEY)));
      if (branches.every(Boolean)) {
        const totalReviews = branches.reduce((sum, branch) => sum + branch.reviewCount, 0);
        const weightedRating = branches.reduce((sum, branch) => sum + (branch.rating * branch.reviewCount), 0);
        payload = {
          branches,
          summary: {
            averageRating: Number((weightedRating / totalReviews).toFixed(1)),
            totalReviews,
          },
          updatedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error('Google reviews refresh failed:', error);
    }
  }

  const response = json(payload, 200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400, s-maxage=86400',
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function fetchBranch(branch, apiKey) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri',
    },
    body: JSON.stringify({ textQuery: branch.query, maxResultCount: 1 }),
  });
  if (!response.ok) throw new Error(`Places API returned ${response.status}`);
  const data = await response.json();
  const place = data.places && data.places[0];
  if (!place || typeof place.rating !== 'number' || typeof place.userRatingCount !== 'number') return null;
  return {
    key: branch.key,
    name: branch.name,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    mapsUrl: place.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
