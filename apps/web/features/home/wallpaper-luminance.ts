/**
 * Wallpaper brightness measurement (P1): decides whether a custom
 * background is TOO BRIGHT for unadapted tile text, so the scene can lay
 * the ~6% bg.deep readability veil over it (visual-directions-p1.md §规范
 * 要点: 壁纸过亮时自动加 6% bg.deep 罩层).
 *
 * Pure-ish browser utility: decodes the image once, downsamples to a tiny
 * canvas and averages relative luminance (Rec. 709). Results are cached
 * per image URL for the tab session — a wallpaper never re-measures.
 */

/**
 * Mean relative luminance from 0 (black) to 1 (white) at or above which a
 * wallpaper counts as bright. Tuned so typical daylight photos and pale
 * illustrations get the veil while dusk and studio-dark images do not.
 */
export const WALLPAPER_BRIGHT_LUMINANCE_THRESHOLD = 0.6;

/** Downsample target: a 32×32 grid is plenty for a mean. */
const SAMPLE_SIZE = 32;

const brightByUrl = new Map<string, boolean>();

function meanLuminance(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context === null) {
          resolve(0);
          return;
        }
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Rec. 709 relative luminance from nonlinear sRGB values — a
          // ranking signal, not a colorimetric measurement.
          sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
        }
        resolve(sum / (data.length / 4));
      } catch {
        // A tainted or undrawable image is never "bright" — no veil.
        resolve(0);
      }
    };
    image.onerror = () => reject(new Error("wallpaper luminance probe failed to load"));
    image.src = url;
  });
}

/**
 * Whether the image behind `url` is bright enough to need the readability
 * veil. Cached per URL; a measurement failure resolves `false` (no veil —
 * the scene stays exactly as readable as it was).
 */
export async function isWallpaperBright(url: string): Promise<boolean> {
  const cached = brightByUrl.get(url);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const bright = (await meanLuminance(url)) >= WALLPAPER_BRIGHT_LUMINANCE_THRESHOLD;
    brightByUrl.set(url, bright);
    return bright;
  } catch {
    brightByUrl.set(url, false);
    return false;
  }
}
