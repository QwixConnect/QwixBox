import { createTheme, type MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#e8f3ff",
  "#d0e4ff",
  "#a1c6fb",
  "#6ea7f7",
  "#478df4",
  "#2f7cf2",
  "#2173f2",
  "#1462d8",
  "#0457c2",
  "#004aac",
];

export const theme = createTheme({
  primaryColor: "brand",
  colors: { brand },

  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',

  headings: { fontWeight: "600" },
  defaultRadius: "md",

  components: {
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: "sm" } },
    Button: { defaultProps: { variant: "light" } },
  },
});
