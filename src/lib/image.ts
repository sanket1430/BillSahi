/**
 * Shrinks a phone photo in the browser before upload.
 * Budget by total pixels, not by longest side: long thermal receipts are
 * tall and thin, and capping the long side would make their text unreadable.
 */
export async function prepareImage(
  file: Blob,
  maxPixels = 2_400_000,
  maxSide = 3200,
): Promise<{ dataUrl: string; mimeType: string }> {
  const { source, width, height, cleanup } = await decode(file);
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  cleanup();
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.86), mimeType: "image/jpeg" };
}

async function decode(file: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("unsupported-image");
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  }
}
