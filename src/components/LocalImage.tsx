import { useEffect, useState } from "react";
import { readFileBytes } from "../api";

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

/** Renders a local image file by reading its bytes into a blob URL. */
export default function LocalImage({
  path,
  className,
  alt = "",
}: {
  path: string;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    readFileBytes(path)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([bytes as BlobPart], { type: mimeFor(path) });
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (failed) return <div className={`img-fallback ${className ?? ""}`} />;
  if (!src) return <div className={`img-loading ${className ?? ""}`} />;
  return <img src={src} className={className} alt={alt} />;
}
