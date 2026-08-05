import type {RefObject} from "react";
export function MapViewport({mapRef, className = "reference-map"}: {mapRef: RefObject<HTMLDivElement | null>; className?: string}) {
  return <div className={className} ref={mapRef} />;
}
