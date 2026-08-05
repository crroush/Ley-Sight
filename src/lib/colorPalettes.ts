export type ColorPalette =
  | "turbo"
  | "viridis"
  | "plasma"
  | "inferno"
  | "magma"
  | "cividis"
  | "icefire";

export const COLOR_PALETTES: ReadonlyArray<{
  value: ColorPalette;
  label: string;
}> = [
  { value: "turbo", label: "Turbo" },
  { value: "viridis", label: "Viridis" },
  { value: "plasma", label: "Plasma" },
  { value: "inferno", label: "Inferno" },
  { value: "magma", label: "Magma" },
  { value: "cividis", label: "Cividis" },
  { value: "icefire", label: "Ice–Fire" },
];

const STOPS: Record<ColorPalette, readonly string[]> = {
  turbo: [
    // 64 samples from Matplotlib's Turbo table. The previous seven-stop
    // approximation visibly changed the Reference gradient tracks and compressed
    // numeric CSV colors into broad bands.
    "#30123b", "#351e58", "#392a73", "#3d358b", "#4040a2", "#424bb5",
    "#4456c7", "#4661d6", "#466be3", "#4776ee", "#4680f6", "#458afc",
    "#4294ff", "#3d9efe", "#37a8fa", "#2fb2f4", "#27bee9", "#20c7df",
    "#1bd0d5", "#18d7ca", "#18dec0", "#1ae4b6", "#20eaac", "#2aefa1",
    "#35f394", "#43f787", "#52fa7a", "#61fc6c", "#71fe5f", "#80ff53",
    "#8fff49", "#9cfe40", "#a9fb39", "#b4f836", "#bef434", "#c8ef34",
    "#d2e935", "#dbe236", "#e3db38", "#ebd339", "#f1cb3a", "#f6c33a",
    "#faba39", "#fcb136", "#fea732", "#fe9b2d", "#fe9029", "#fc8423",
    "#f9751d", "#f56918", "#f15d13", "#ec530f", "#e7490c", "#e14109",
    "#da3907", "#d23105", "#ca2a04", "#c12302", "#b71d02", "#ac1701",
    "#a11201", "#950d01", "#880802", "#7a0403",
  ],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  cividis: ["#00224e", "#26456e", "#576d6d", "#8a8a65", "#c1ac54", "#fee838"],
  icefire: [
    "#001f3f",
    "#0077b6",
    "#90e0ef",
    "#f7f7f7",
    "#fcbf49",
    "#f77f00",
    "#9d0208",
  ],
};

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

export function gradientColor(
  rawValue: number,
  palette: ColorPalette = "turbo",
  alpha = 222,
): number {
  const value = Math.max(0, Math.min(1, rawValue));
  const stops = STOPS[palette];
  const scaled = value * (stops.length - 1);
  const leftIndex = Math.min(stops.length - 1, Math.floor(scaled));
  const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
  const ratio = scaled - leftIndex;
  const left = rgb(stops[leftIndex]);
  const right = rgb(stops[rightIndex]);
  const red = Math.round(left[0] + (right[0] - left[0]) * ratio);
  const green = Math.round(left[1] + (right[1] - left[1]) * ratio);
  const blue = Math.round(left[2] + (right[2] - left[2]) * ratio);
  return (
    ((red & 255) << 24) |
    ((green & 255) << 16) |
    ((blue & 255) << 8) |
    Math.max(0, Math.min(255, alpha))
  ) >>> 0;
}

export function paletteCss(palette: ColorPalette): string {
  return `linear-gradient(90deg, ${STOPS[palette].join(", ")})`;
}
