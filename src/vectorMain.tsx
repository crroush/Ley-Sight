import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import "ol/ol.css";
import {BasicMapExampleApp} from "./demos/BasicMapExampleApp";
import {
  FastPointsPerformanceExampleApp,
  GeoUncertaintyExampleApp,
} from "./demos/FastPointsExamples";
import {LayerTypesExampleApp} from "./demos/LayerTypesExampleApp";
import {
  FeatureSelectionExampleApp,
  SelectionRecolorExampleApp,
} from "./demos/SelectionExamples";
import {GradientTracksExampleApp} from "./demos/GradientTracksExampleApp";
import {MovableVectorExampleApp} from "./demos/MovableVectorExampleApp";
import "./styles.css";
import "./demos/demo.css";

const example = new URLSearchParams(window.location.search).get("example");

function VectorEntry() {
  if (example === "01") return <BasicMapExampleApp />;
  if (example === "02") return <LayerTypesExampleApp />;
  if (example === "03") return <FastPointsPerformanceExampleApp />;
  if (example === "06") return <GeoUncertaintyExampleApp />;
  if (example === "07") return <FeatureSelectionExampleApp />;
  if (example === "09") return <SelectionRecolorExampleApp />;
  if (example === "18") return <GradientTracksExampleApp />;
  if (example === "21") return <MovableVectorExampleApp />;
  return <BasicMapExampleApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VectorEntry />
  </StrictMode>,
);
