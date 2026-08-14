// Client-side photo compression before upload. Raw camera captures from
// field devices commonly run 3-4MB uncompressed, which times out on slow
// mobile connections against Kong's default proxy timeouts (observed in
// production storage logs: uploads that take >60s to send get killed with
// a 400/ABORTED REQ). Shrinking to a reasonable max dimension + JPEG
// quality here cuts typical uploads to a few hundred KB, which both
// avoids the timeout and saves the field team's mobile data.
export async function compressImage(
  file: File,
  { maxDimension = 1600, quality = 0.72 }: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  // Non-image files (shouldn't happen given accept="image/*", but be safe)
  // or types the canvas path can't help with pass through untouched.
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) return file;

  // Only use the compressed version if it's actually smaller — a tiny
  // already-optimized source image could re-encode larger at these settings.
  if (blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}
