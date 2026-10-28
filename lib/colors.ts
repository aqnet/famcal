// Calendar palette from visualdesign.md. None reuse --accent (teal) or --rain (blue), and white
// text on each stays at or above 4.5:1.
export const DEFAULT_CALENDAR_COLORS = [
  "#A3366F", // berry
  "#4A5560", // slate
  "#B5501A", // orange
  "#6B4FA0", // purple
  "#2E7D32", // green
  "#8D6E00", // ochre
  "#5D4037", // brown
];

const RESERVED = ["#1F5C5A", "#6FB3AE", "#1F6FB2", "#7DB4E6"]; // accent and rain, light and dark

export function isAllowedCalendarColor(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex) && !RESERVED.includes(hex.toUpperCase());
}
