import type { Track } from '../types';

// Public Invidious instances for privacy-respecting YouTube audio search
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.tux.pizza',
  'https://invidious.drgns.space',
  'https://vid.puffyan.us'
];

let activeInstanceIndex = 0;

function getActiveInstance(): string {
  return INVIDIOUS_INSTANCES[activeInstanceIndex];
}

function rotateInstance(): void {
  activeInstanceIndex = (activeInstanceIndex + 1) % INVIDIOUS_INSTANCES.length;
}

export async function searchFreeMusic(query: string): Promise<Track[]> {
  if (!query.trim()) return [];

  for (let attempt = 0; attempt < INVIDIOUS_INSTANCES.length; attempt++) {
    const baseUrl = getActiveInstance();
    try {
      const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        rotateInstance();
        continue;
      }

      const data = await response.json();
      
      return data.slice(0, 15).map((item: any) => {
        // Find best audio stream or fallback to direct video stream format
        const videoId = item.videoId;
        const thumbnail = item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url 
          || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
          id: videoId,
          title: item.title,
          artist: item.author || 'Unknown Artist',
          album: 'Single / Web Stream',
          duration: item.lengthSeconds || 180,
          cover: thumbnail,
          // Direct audio playback URL via Invidious proxy stream endpoint
          streamUrl: `${baseUrl}/latest_version?id=${videoId}&itag=140`, 
          source: 'youtube'
        };
      });
    } catch (err) {
      console.warn(`Failed search on ${baseUrl}, trying next instance...`, err);
      rotateInstance();
    }
  }

  // Fallback demo tracks if network requests fail
  return [
    {
      id: 'fb-1',
      title: `${query} (Demo Stream)`,
      artist: 'Free Source Resolver',
      album: 'Aggregated Stream',
      duration: 210,
      cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80',
      streamUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
      source: 'youtube'
    }
  ];
}
