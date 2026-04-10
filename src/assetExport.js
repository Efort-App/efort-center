import JSZip from "jszip";

function sanitizeFilenamePart(value, fallback = "asset") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function inferExtension(urlValue, contentType) {
  const normalizedType = String(contentType || "").toLowerCase();
  if (normalizedType.includes("image/png")) return ".png";
  if (normalizedType.includes("image/jpeg")) return ".jpg";
  if (normalizedType.includes("image/webp")) return ".webp";
  if (normalizedType.includes("image/gif")) return ".gif";

  try {
    const url = new URL(urlValue);
    const pathname = url.pathname.toLowerCase();
    const match = pathname.match(/\.(png|jpe?g|webp|gif)$/);
    if (!match) return ".bin";
    return match[0] === ".jpeg" ? ".jpg" : match[0];
  } catch {
    return ".bin";
  }
}

function triggerBlobDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadAssetZip(filename, assets) {
  const zip = new JSZip();
  const filenameCounts = new Map();
  const failures = [];
  let successCount = 0;

  for (const asset of assets) {
    if (!asset?.url) continue;

    try {
      const response = await fetch(asset.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const extension = inferExtension(asset.url, response.headers.get("content-type"));
      const baseName = sanitizeFilenamePart(asset.name, "asset");
      const seenCount = filenameCounts.get(baseName) || 0;
      filenameCounts.set(baseName, seenCount + 1);
      const suffix = seenCount === 0 ? "" : `-${seenCount + 1}`;
      zip.file(`${baseName}${suffix}${extension}`, blob);
      successCount += 1;
    } catch (error) {
      failures.push(`${asset.name || asset.url}: ${error?.message || "download failed"}`);
    }
  }

  if (successCount === 0) {
    throw new Error("No asset files were downloadable from the available Meta URLs.");
  }

  if (failures.length > 0) {
    zip.file("_errors.txt", failures.join("\n"));
  }

  const blob = await zip.generateAsync({type: "blob"});
  triggerBlobDownload(filename, blob);
}

export function buildAssetBaseName(parts) {
  return parts
    .map((part) => sanitizeFilenamePart(part, ""))
    .filter(Boolean)
    .join("__");
}
