import type { ImageStyle, TextStyle, ViewStyle } from "react-native";

export type MobileNamedStyles = Record<
  string,
  ViewStyle | TextStyle | ImageStyle
>;
