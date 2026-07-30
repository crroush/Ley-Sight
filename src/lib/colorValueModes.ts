export type ColorValueMode = "categorical" | "continuous" | "auto";

export const COLOR_VALUE_MODES: ReadonlyArray<{
  value: ColorValueMode;
  label: string;
}> = [
  { value: "categorical", label: "Categories" },
  { value: "continuous", label: "Continuous" },
  { value: "auto", label: "Auto" },
];
