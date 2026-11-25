import { useEffect, useState } from 'react';

/** Turn ImageData into an ImageBitmap for fast canvas drawing. */
export function useBitmap(img: ImageData | null): ImageBitmap | null {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (!img) {
      setBmp(null);
      return;
    }
    let cancelled = false;
    let made: ImageBitmap | null = null;
    createImageBitmap(img).then((b) => {
      if (cancelled) b.close();
      else {
        made = b;
        setBmp(b);
      }
    });
    return () => {
      cancelled = true;
      made?.close();
    };
  }, [img]);
  return bmp;
}
