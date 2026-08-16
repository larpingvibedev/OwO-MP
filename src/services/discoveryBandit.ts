/**
 * Local Multi-Armed Bandit (Explore vs. Exploit) Engine for Music Recommendations.
 * 
 * Tracks user engagement with recommended artists purely in localStorage.
 * - Exploit: Reinforces artists the user frequently listens to and clicks on.
 * - Explore: Injects new or lesser-known peer artists to discover fresh preferences.
 * - Decays / Phases out artists that are repeatedly shown without user engagement.
 */

const BANDIT_STORAGE_KEY = 'owo_dash_bandit_v1';

export interface BanditArtistStats {
  artist: string;
  impressions: number;
  engagements: number;
  lastShownAt: number;
  lastEngagedAt?: number;
  score: number;
}

interface BanditStoreData {
  stats: Record<string, BanditArtistStats>;
  lastUpdated: number;
}

function loadBanditData(): BanditStoreData {
  try {
    const raw = localStorage.getItem(BANDIT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.stats === 'object') {
        return parsed;
      }
    }
  } catch {}
  return { stats: {}, lastUpdated: Date.now() };
}

function saveBanditData(data: BanditStoreData) {
  try {
    localStorage.setItem(BANDIT_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * Calculates Upper Confidence Bound (UCB1) style score for exploration vs exploitation.
 * score = (engagements / impressions) + sqrt(2 * ln(totalImpressions) / impressions)
 */
function calculateBanditScore(engagements: number, impressions: number, totalImpressions: number): number {
  if (impressions === 0) return 1.5; // High initial exploration bonus
  const exploitation = engagements / impressions;
  const exploration = Math.sqrt((2 * Math.log(Math.max(totalImpressions, 1) + 1)) / impressions);
  return exploitation + 0.6 * exploration;
}

/**
 * Record impressions when artists are displayed in recommendation carousels.
 */
export function recordArtistImpressions(artists: string[]): void {
  if (!artists || artists.length === 0) return;
  const data = loadBanditData();
  const now = Date.now();
  
  let totalImpressions = Object.values(data.stats).reduce((acc, s) => acc + s.impressions, 0);

  artists.forEach(rawArt => {
    if (!rawArt) return;
    const art = rawArt.trim();
    if (!art || art.toLowerCase() === 'various artists') return;

    const existing = data.stats[art] || {
      artist: art,
      impressions: 0,
      engagements: 0,
      lastShownAt: now,
      score: 1.0
    };

    existing.impressions += 1;
    existing.lastShownAt = now;
    totalImpressions += 1;
    existing.score = calculateBanditScore(existing.engagements, existing.impressions, totalImpressions);
    data.stats[art] = existing;
  });

  data.lastUpdated = now;
  saveBanditData(data);
}

/**
 * Record positive interaction (click, play, favorite) with an artist's track or card.
 */
export function recordArtistEngagement(rawArtist: string): void {
  if (!rawArtist) return;
  const art = rawArtist.trim();
  if (!art || art.toLowerCase() === 'various artists') return;

  const data = loadBanditData();
  const now = Date.now();
  const totalImpressions = Object.values(data.stats).reduce((acc, s) => acc + s.impressions, 0);

  const existing = data.stats[art] || {
    artist: art,
    impressions: 1,
    engagements: 0,
    lastShownAt: now,
    score: 1.0
  };

  existing.engagements += 1;
  existing.lastEngagedAt = now;
  existing.score = calculateBanditScore(existing.engagements, existing.impressions, totalImpressions + 1);
  data.stats[art] = existing;

  data.lastUpdated = now;
  saveBanditData(data);
}

/**
 * Selects a blend of Exploit (top habitual + high engagement) and Explore (fresh / candidate) artist seeds.
 */
export function getBanditArtistSeeds(
  userTopArtists: string[], 
  availableCandidates: string[] = []
): { exploit: string[]; explore: string[]; blended: string[] } {
  const data = loadBanditData();
  const stats = data.stats;

  // Filter out any artists shown > 5 times with 0 engagements in the last 7 days (decayed/fatigued)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isFatigued = (art: string) => {
    const s = stats[art];
    if (!s) return false;
    return s.impressions >= 5 && s.engagements === 0 && s.lastShownAt > sevenDaysAgo;
  };

  // 1. Exploit Pool: User's top artists, prioritized by bandit score
  const nonFatiguedUserArtists = userTopArtists.filter(a => a && !isFatigued(a));
  const scoredUserArtists = [...nonFatiguedUserArtists].sort((a, b) => {
    const scoreA = stats[a]?.score ?? 1.0;
    const scoreB = stats[b]?.score ?? 1.0;
    return scoreB - scoreA;
  });

  const exploit = scoredUserArtists.slice(0, 4);

  // 2. Explore Pool: Pick candidate artists that haven't been over-shown
  const candidatePool = availableCandidates.filter(
    c => c && !exploit.includes(c) && !isFatigued(c)
  );

  // Sort candidate pool by exploration potential (unseen or high score)
  const scoredCandidates = [...candidatePool].sort((a, b) => {
    const scoreA = stats[a]?.score ?? 1.5;
    const scoreB = stats[b]?.score ?? 1.5;
    return scoreB - scoreA;
  });

  const explore = scoredCandidates.slice(0, 2);

  // 3. Blend: ~75% Exploit, ~25% Explore
  const blended: string[] = [];
  let exploitIdx = 0;
  let exploreIdx = 0;

  while (blended.length < 5 && (exploitIdx < exploit.length || exploreIdx < explore.length)) {
    if (exploitIdx < exploit.length) {
      blended.push(exploit[exploitIdx++]);
    }
    if (blended.length < 5 && exploreIdx < explore.length && Math.random() < 0.4) {
      blended.push(explore[exploreIdx++]);
    }
  }

  // Ensure at least exploit seeds are present if blend is empty
  const finalBlended = blended.length > 0 ? blended : (userTopArtists.slice(0, 4));

  return {
    exploit,
    explore,
    blended: finalBlended
  };
}
