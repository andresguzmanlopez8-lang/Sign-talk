// Design tokens for SignBridge — Dark-First Utility theme.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0D0E12",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1A1D24",
  onSurfaceSecondary: "#E2E8F0",
  surfaceTertiary: "#252932",
  onSurfaceTertiary: "#94A3B8",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0D0E12",
  muted: "#64748B",

  brand: "#FF5722",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF5722",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E64A19",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#422014",
  onBrandTertiary: "#FF5722",

  success: "#10B981",
  onSuccess: "#000000",
  warning: "#F59E0B",
  onWarning: "#000000",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",

  border: "#2A2F3A",
  borderStrong: "#4A5266",
  divider: "#1F232D",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

setColorScheme?.(themes.light ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system === "light" && themes.light ? "light" : "dark";
  return { scheme, colors: themes[scheme] ?? themes.dark };
}

export const colors = themes.dark;

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
