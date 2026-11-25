/** Largest side (px) of photos we analyze; bigger photos are downscaled on load. */
export const MAX_PHOTO_PX = 2400;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** Decode an image file (applying EXIF orientation) into ImageData, downscaled to fit. */
export async function loadImageFile(file: Blob, maxSide = MAX_PHOTO_PX): Promise<ImageData> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return g.getImageData(0, 0, w, h);
}

/** Wrap worker output ({data,width,height}) as a real ImageData. */
export const toImageData = (img: { data: Uint8ClampedArray; width: number; height: number }): ImageData =>
  img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

/** Encode ImageData as JPEG, optionally downscaled. */
export function encodeJpeg(img: ImageData, maxSide = Infinity, quality = 0.88): Promise<Blob> {
  const src = canvas(img.width, img.height);
  ctx2d(src).putImageData(img, 0, 0);
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const out = k < 1 ? canvas(Math.round(img.width * k), Math.round(img.height * k)) : src;
  if (k < 1) {
    const g = ctx2d(out);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, out.width, out.height);
  }
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
  );
}

/** Decode a stored image blob back into ImageData (no rescaling). */
export async function decodeBlob(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = canvas(bmp.width, bmp.height);
  const g = ctx2d(c);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, c.width, c.height);
}
