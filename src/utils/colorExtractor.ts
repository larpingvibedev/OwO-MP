export interface ExtractedPalette {
  primary: string;       // Top / Accent color (Hex)
  secondary: string;     // Bottom / Gradient color (Hex)
  glow: string;          // Neon shadow glow (rgba)
  peakCap: string;       // White / Light tint for peak caps
}

const DEFAULT_SYNTHWAVE_PALETTE: ExtractedPalette = {
  primary: '#ff007f',    // Hot Pink
  secondary: '#7928ca',  // Synth Purple
  glow: 'rgba(255, 0, 127, 0.45)',
  peakCap: '#ffffff'
};

const paletteCache = new Map<string, ExtractedPalette>();

/**
 * Extracts dominant vibrant colors from an album art image URL.
 * Runs on a 32x32 offscreen canvas for instant 1ms performance.
 */
export async function extractAlbumPalette(imageUrl?: string): Promise<ExtractedPalette> {
  if (!imageUrl) return DEFAULT_SYNTHWAVE_PALETTE;
  if (paletteCache.has(imageUrl)) return paletteCache.get(imageUrl)!;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_SYNTHWAVE_PALETTE);
          return;
        }

        const size = 32;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);

        const imgData = ctx.getImageData(0, 0, size, size).data;
        const colorBuckets: { r: number; g: number; b: number; score: number; count: number }[] = [];

        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];

          if (a < 128) continue;

          // Calculate brightness and saturation
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const delta = max - min;
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const saturation = max === 0 ? 0 : delta / max;

          // Filter out extreme blacks, grays, and pure whites to prioritize vibrant music art accents
          if (brightness < 25 || brightness > 235 || saturation < 0.18) {
            continue;
          }

          // Quantize color into buckets of 24
          const qr = Math.round(r / 24) * 24;
          const qg = Math.round(g / 24) * 24;
          const qb = Math.round(b / 24) * 24;

          // Score colors by high saturation & pleasing musical brightness
          const score = saturation * 2.2 + (1 - Math.abs(brightness - 135) / 135) * 1.5;

          const existing = colorBuckets.find(
            c => Math.abs(c.r - qr) < 28 && Math.abs(c.g - qg) < 28 && Math.abs(c.b - qb) < 28
          );

          if (existing) {
            existing.count++;
            existing.score += score;
          } else {
            colorBuckets.push({ r: qr, g: qg, b: qb, score, count: 1 });
          }
        }

        if (colorBuckets.length === 0) {
          paletteCache.set(imageUrl, DEFAULT_SYNTHWAVE_PALETTE);
          resolve(DEFAULT_SYNTHWAVE_PALETTE);
          return;
        }

        // Sort by vibrant score
        colorBuckets.sort((a, b) => b.score - a.score);

        const primaryRgb = colorBuckets[0];
        // Find distinct secondary color for high-contrast synth gradient
        let secondaryRgb = colorBuckets.find(
          c => Math.hypot(c.r - primaryRgb.r, c.g - primaryRgb.g, c.b - primaryRgb.b) > 75
        );

        if (!secondaryRgb) {
          // If monochromatic artwork, derive aesthetic complementary gradient hue
          secondaryRgb = {
            r: Math.min(255, Math.max(20, Math.round(primaryRgb.r * 0.55 + 40))),
            g: Math.min(255, Math.max(20, Math.round(primaryRgb.g * 0.45 + 70))),
            b: Math.min(255, Math.max(20, Math.round(primaryRgb.b * 0.75 + 50))),
            score: 1,
            count: 1
          };
        }

        const primaryHex = `rgb(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b})`;
        const secondaryHex = `rgb(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b})`;
        const glow = `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.55)`;

        const result: ExtractedPalette = {
          primary: primaryHex,
          secondary: secondaryHex,
          glow,
          peakCap: '#ffffff'
        };

        paletteCache.set(imageUrl, result);
        resolve(result);
      } catch (err) {
        resolve(DEFAULT_SYNTHWAVE_PALETTE);
      }
    };

    img.onerror = () => {
      resolve(DEFAULT_SYNTHWAVE_PALETTE);
    };

    img.src = imageUrl;
  });
}
