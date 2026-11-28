import {
  QuantizerCelebi,
  Score,
  Hct,
  SchemeTonalSpot,
  MaterialDynamicColors,
  argbFromRgb,
  argbFromHex,
  hexFromArgb,
  rgbaFromArgb,
} from "@material/material-color-utilities";

/** @type {number} Kích thước cạnh tối đa khi downscale ảnh để trích xuất màu nhanh */
const DEFAULT_SAMPLE_SIZE = 128;

/** @type {number} Số cụm màu tối đa cho QuantizerCelebi */
const DEFAULT_MAX_QUANTIZE_COLORS = 128;

/** @type {number} Số màu chủ đạo mặc định trả về sau khi chấm điểm */
const DEFAULT_DESIRED_COLORS = 4;

/** @type {number} Ngưỡng alpha tối thiểu (0–255) để pixel được tính vào phân tích */
const MIN_ALPHA_THRESHOLD = 128;

/**
 * Convert an ARGB integer into a CSS `rgba(...)` string with custom alpha.
 * @param {number} argb
 * @param {number} alpha - Opacity in [0, 1].
 * @returns {string}
 */
export function argbToRgba(argb, alpha = 1) {
  const { r, g, b } = rgbaFromArgb(argb);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Draw an image source onto a small 2D canvas and return its ImageData.
 * Accepts `Blob`, `ImageBitmap`, `HTMLImageElement`, `HTMLCanvasElement`, or `OffscreenCanvas`.
 * @param {Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} source
 * @param {number} sampleSize
 * @returns {Promise<ImageData>}
 */
async function readSampleImageData(source, sampleSize) {
  let bitmap = null;
  let shouldCloseBitmap = false;

  try {
    let drawable = source;
    if (source instanceof Blob) {
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(source);
        shouldCloseBitmap = true;
        drawable = bitmap;
      } else {
        throw new Error(
          "[materialColor] createImageBitmap is required to decode Blob sources.",
        );
      }
    }

    const srcWidth =
      drawable.naturalWidth || drawable.videoWidth || drawable.width || 0;
    const srcHeight =
      drawable.naturalHeight || drawable.videoHeight || drawable.height || 0;

    if (!srcWidth || !srcHeight) {
      throw new Error("[materialColor] Image source has zero dimensions.");
    }

    const scale = Math.min(1, sampleSize / Math.max(srcWidth, srcHeight));
    const targetW = Math.max(1, Math.round(srcWidth * scale));
    const targetH = Math.max(1, Math.round(srcHeight * scale));

    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(targetW, targetH)
        : Object.assign(document.createElement("canvas"), {
            width: targetW,
            height: targetH,
          });

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("[materialColor] Failed to acquire 2D canvas context.");
    }

    ctx.drawImage(drawable, 0, 0, targetW, targetH);
    return ctx.getImageData(0, 0, targetW, targetH);
  } finally {
    if (shouldCloseBitmap && bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

/**
 * Extract ranked Material 3 seed colors from raw RGBA pixel bytes.
 * @param {Uint8ClampedArray|Uint8Array|Array<number>} rgbaBytes
 * @param {Object} [options]
 * @param {number} [options.desired=4] - Maximum number of ranked colors to return.
 * @param {number} [options.maxColors=128] - Cluster count for `QuantizerCelebi`.
 * @param {boolean} [options.filter=true] - Filter low-chroma / low-population hues.
 * @param {number} [options.fallbackColorARGB=0xff4285f4] - Fallback ARGB if no color qualifies.
 * @returns {{ seed: string, seedArgb: number, colors: string[], argbs: number[] }}
 */
export function extractSeedColorsFromPixels(rgbaBytes, options = {}) {
  const {
    desired = DEFAULT_DESIRED_COLORS,
    maxColors = DEFAULT_MAX_QUANTIZE_COLORS,
    filter = true,
    fallbackColorARGB = 0xff4285f4,
  } = options;

  const pixels = [];
  for (let i = 0; i + 3 < rgbaBytes.length; i += 4) {
    if (rgbaBytes[i + 3] < MIN_ALPHA_THRESHOLD) continue;
    pixels.push(argbFromRgb(rgbaBytes[i], rgbaBytes[i + 1], rgbaBytes[i + 2]));
  }

  const quantized =
    pixels.length > 0
      ? QuantizerCelebi.quantize(pixels, maxColors)
      : new Map([[fallbackColorARGB, 1]]);

  const ranked = Score.score(quantized, {
    desired,
    fallbackColorARGB,
    filter,
  });

  const argbs = ranked.length > 0 ? ranked : [fallbackColorARGB];
  const colors = argbs.map((argb) => hexFromArgb(argb));

  return {
    seed: colors[0],
    seedArgb: argbs[0],
    colors,
    argbs,
  };
}

/**
 * Extract ranked Material 3 seed colors from an image (`Blob`, `ImageBitmap`, `HTMLImageElement`, or canvas).
 * @param {Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} source
 * @param {Object} [options]
 * @param {number} [options.sampleSize=128] - Max dimension (px) for downscaled sampling.
 * @param {number} [options.desired=4] - Maximum number of ranked colors to return.
 * @param {number} [options.maxColors=128] - Cluster count for `QuantizerCelebi`.
 * @param {boolean} [options.filter=true] - Filter low-chroma / low-population hues.
 * @param {number} [options.fallbackColorARGB=0xff4285f4] - Fallback ARGB if no color qualifies.
 * @returns {Promise<{ seed: string, seedArgb: number, colors: string[], argbs: number[] }>}
 */
export async function extractSeedColorsFromImage(source, options = {}) {
  const { sampleSize = DEFAULT_SAMPLE_SIZE, ...scoreOptions } = options;
  const imageData = await readSampleImageData(source, sampleSize);
  return extractSeedColorsFromPixels(imageData.data, scoreOptions);
}

/**
 * Build a Material 3 color scheme + glassmorphism-ready tokens from a seed color.
 * @param {string|number} seedColor - Hex string (e.g. `"#6750a4"`) or ARGB integer.
 * @param {Object} [options]
 * @param {boolean} [options.isDark=true] - Use dark mode M3 scheme (matches Yumebako glass UI).
 * @param {number} [options.contrastLevel=0] - M3 contrast level in [-1, 1].
 * @returns {{
 *   seed: string,
 *   isDark: boolean,
 *   scheme: Record<string, string>,
 *   glass: Record<string, string>
 * }}
 */
export function buildM3GlassTokens(seedColor, options = {}) {
  const { isDark = true, contrastLevel = 0 } = options;
  const seedArgb =
    typeof seedColor === "number" ? seedColor : argbFromHex(seedColor);
  const scheme = new SchemeTonalSpot(
    Hct.fromInt(seedArgb),
    isDark,
    contrastLevel,
  );

  const primaryArgb = MaterialDynamicColors.primary.getArgb(scheme);
  const onPrimaryArgb = MaterialDynamicColors.onPrimary.getArgb(scheme);
  const primaryContainerArgb =
    MaterialDynamicColors.primaryContainer.getArgb(scheme);
  const secondaryArgb = MaterialDynamicColors.secondary.getArgb(scheme);
  const secondaryContainerArgb =
    MaterialDynamicColors.secondaryContainer.getArgb(scheme);
  const tertiaryArgb = MaterialDynamicColors.tertiary.getArgb(scheme);
  const surfaceArgb = MaterialDynamicColors.surface.getArgb(scheme);
  const surfaceContainerArgb =
    MaterialDynamicColors.surfaceContainer.getArgb(scheme);
  const surfaceContainerHighArgb =
    MaterialDynamicColors.surfaceContainerHigh.getArgb(scheme);
  const surfaceContainerHighestArgb =
    MaterialDynamicColors.surfaceContainerHighest.getArgb(scheme);
  const inverseSurfaceArgb =
    MaterialDynamicColors.inverseSurface.getArgb(scheme);
  const onSurfaceArgb = MaterialDynamicColors.onSurface.getArgb(scheme);
  const onSurfaceVariantArgb =
    MaterialDynamicColors.onSurfaceVariant.getArgb(scheme);
  const outlineArgb = MaterialDynamicColors.outline.getArgb(scheme);
  const outlineVariantArgb =
    MaterialDynamicColors.outlineVariant.getArgb(scheme);

  return {
    seed: hexFromArgb(seedArgb),
    isDark,
    scheme: {
      primary: hexFromArgb(primaryArgb),
      onPrimary: hexFromArgb(onPrimaryArgb),
      primaryContainer: hexFromArgb(primaryContainerArgb),
      secondary: hexFromArgb(secondaryArgb),
      secondaryContainer: hexFromArgb(secondaryContainerArgb),
      tertiary: hexFromArgb(tertiaryArgb),
      surface: hexFromArgb(surfaceArgb),
      surfaceContainer: hexFromArgb(surfaceContainerArgb),
      surfaceContainerHigh: hexFromArgb(surfaceContainerHighArgb),
      surfaceContainerHighest: hexFromArgb(surfaceContainerHighestArgb),
      inverseSurface: hexFromArgb(inverseSurfaceArgb),
      onSurface: hexFromArgb(onSurfaceArgb),
      onSurfaceVariant: hexFromArgb(onSurfaceVariantArgb),
      outline: hexFromArgb(outlineArgb),
      outlineVariant: hexFromArgb(outlineVariantArgb),
    },
    glass: {
      panelBg: argbToRgba(surfaceContainerHighArgb, 0.45),
      surfaceBg: argbToRgba(inverseSurfaceArgb, 0.06),
      surfaceActBg: argbToRgba(inverseSurfaceArgb, 0.04),
      buttonBg: argbToRgba(inverseSurfaceArgb, 0.12),
      buttonHoverBg: argbToRgba(inverseSurfaceArgb, 0.2),
      buttonActBg: argbToRgba(inverseSurfaceArgb, 0.16),
      border: argbToRgba(primaryArgb, 0.22),
      borderSubtle: argbToRgba(outlineArgb, 0.16),
      accent: hexFromArgb(primaryArgb),
      accentGlow: argbToRgba(primaryArgb, 0.28),
    },
    solid: {
      background: hexFromArgb(surfaceArgb),
      panelBg: hexFromArgb(surfaceContainerArgb),
      surfaceBg: hexFromArgb(surfaceContainerHighArgb),
      surfaceActBg: hexFromArgb(surfaceContainerHighestArgb),
      buttonBg: hexFromArgb(secondaryContainerArgb),
      buttonHoverBg: hexFromArgb(primaryContainerArgb),
      buttonActBg: hexFromArgb(surfaceContainerHighestArgb),
      border: hexFromArgb(outlineVariantArgb),
      borderSubtle: argbToRgba(outlineVariantArgb, 0.55),
      textPrimary: hexFromArgb(onSurfaceArgb),
      textSecondary: hexFromArgb(onSurfaceVariantArgb),
    },
  };
}

/**
 * Extract Material 3 seed colors from an image and generate M3 + glassmorphism tokens in one call.
 * @param {Blob|ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} source
 * @param {Object} [options]
 * @returns {Promise<{
 *   seed: string,
 *   seedArgb: number,
 *   colors: string[],
 *   argbs: number[],
 *   isDark: boolean,
 *   scheme: Record<string, string>,
 *   glass: Record<string, string>
 * }>}
 */
export async function extractM3ThemeFromImage(source, options = {}) {
  const { isDark = true, contrastLevel = 0, ...extractOptions } = options;
  const extracted = await extractSeedColorsFromImage(source, extractOptions);
  const tokens = buildM3GlassTokens(extracted.seedArgb, {
    isDark,
    contrastLevel,
  });

  return {
    ...extracted,
    ...tokens,
  };
}
