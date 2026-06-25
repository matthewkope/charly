import { useEffect, useState } from "react";
import { getPdfCover } from "../covers";
import "./CoverThumb.css";

/**
 * Renders a page-1 PDF thumbnail for `path`. While the cover is loading, or if
 * it can't be rendered, falls back to the emoji `fallback` icon.
 */
export default function CoverThumb({ path, fallback }: { path: string; fallback: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    getPdfCover(path)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  if (!src) return <span className="item-icon">{fallback}</span>;
  return <img className="item-cover" src={src} alt="" />;
}
