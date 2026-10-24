import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Exact Accent (#2563EB) & Danger (#D70015 / #FF6961) palettes from docs/design/design-tokens.png
const brand: MantineColorsTuple = [
  "#eff6ff",
  "#dbeafe",
  "#bfdbfe",
  "#93c5fd",
  "#6aa2ff",
  "#3b82f6",
  "#2563eb",
  "#1d4ed8",
  "#1e40af",
  "#1e3a8a",
];

const danger: MantineColorsTuple = [
  "#fff0f0",
  "#ffdede",
  "#ffbfbf",
  "#ff9494",
  "#ff6961",
  "#ef4444",
  "#d70015",
  "#b80012",
  "#99000f",
  "#7a000c",
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 6 },
  colors: {
    brand,
    red: danger,
  },

  fontFamily:
    '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',

  headings: {
    fontFamily:
      '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontWeight: "800",
    sizes: {
      h1: { fontSize: "2.375rem", lineHeight: "1.1", fontWeight: "600" }, // Display 38 / 600
      h2: { fontSize: "2.125rem", lineHeight: "1.12", fontWeight: "800" }, // Large title 34 / 800
      h3: { fontSize: "1.375rem", lineHeight: "1.25", fontWeight: "700" }, // Section 22 / 700
      h4: { fontSize: "1.0625rem", lineHeight: "1.35", fontWeight: "600" }, // Headline 17 / 600
    },
  },

  fontSizes: {
    xs: "0.8125rem", // Caption 13px
    sm: "0.9375rem", // Body 15px
    md: "0.9375rem", // Body 15px
    lg: "1.0625rem", // Headline 17px
    xl: "2.125rem", // Keypad / Large 34px
  },

  radius: {
    xs: "0.5rem", // 8px
    sm: "0.75rem", // 12px · fields
    md: "0.75rem", // 12px · fields
    lg: "1.25rem", // 20px · cards
    xl: "9999px", // full · actions
  },
  defaultRadius: "md",

  components: {
    Button: {
      defaultProps: {
        variant: "filled",
        size: "md",
        radius: "md",
      },
      styles: {
        root: {
          minHeight: "44px",
          fontWeight: 600,
          fontSize: "0.9375rem",
          letterSpacing: "-0.01em",
          paddingInline: "20px",
          border: "none",
          boxShadow: "none",
        },
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: "xl",
        size: "lg",
      },
      styles: {
        root: {
          minWidth: "40px",
          minHeight: "40px",
        },
      },
    },
    Card: {
      defaultProps: {
        radius: "lg",
        padding: "lg",
        withBorder: false,
        shadow: "none",
      },
      styles: {
        root: {
          backgroundColor: "var(--qb-surface)",
          border: "none",
          boxShadow: "none",
        },
      },
    },
    Paper: {
      defaultProps: {
        radius: "lg",
        withBorder: false,
        shadow: "none",
      },
    },
    Modal: {
      defaultProps: {
        radius: "lg",
        padding: "xl",
        centered: true,
        overlayProps: { backgroundOpacity: 0.45, blur: 4 },
      },
      styles: {
        content: {
          backgroundColor: "var(--qb-bg)",
          border: "1px solid var(--qb-separator)",
          boxShadow: "none",
        },
        header: {
          backgroundColor: "var(--qb-bg)",
          paddingBottom: "12px",
        },
        title: {
          fontWeight: 800,
          fontSize: "1.25rem",
          letterSpacing: "-0.02em",
          color: "var(--qb-text-primary)",
        },
      },
    },
    TextInput: {
      defaultProps: {
        size: "md",
        radius: "md",
      },
      styles: {
        label: {
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        description: {
          fontSize: "0.75rem",
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        input: {
          minHeight: "46px",
          backgroundColor: "var(--qb-surface)",
          border: "1px solid transparent",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
          paddingInline: "14px",
        },
      },
    },
    PasswordInput: {
      defaultProps: {
        size: "md",
        radius: "md",
      },
      styles: {
        label: {
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        input: {
          minHeight: "46px",
          backgroundColor: "var(--qb-surface)",
          border: "1px solid transparent",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
        },
        innerInput: {
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
          paddingInline: "14px",
        },
      },
    },
    NumberInput: {
      defaultProps: {
        size: "md",
        radius: "md",
      },
      styles: {
        label: {
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        description: {
          fontSize: "0.75rem",
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        input: {
          minHeight: "46px",
          backgroundColor: "var(--qb-surface)",
          border: "1px solid transparent",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
          paddingInline: "14px",
        },
      },
    },
    Select: {
      defaultProps: {
        size: "md",
        radius: "md",
      },
      styles: {
        label: {
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        description: {
          fontSize: "0.75rem",
          color: "var(--qb-text-secondary)",
          marginBottom: "6px",
        },
        input: {
          minHeight: "46px",
          backgroundColor: "var(--qb-surface)",
          border: "1px solid transparent",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
          paddingInline: "14px",
        },
        dropdown: {
          backgroundColor: "var(--qb-raised)",
          border: "1px solid var(--qb-separator)",
          borderRadius: "12px",
          boxShadow: "none",
        },
      },
    },
    Table: {
      defaultProps: {
        highlightOnHover: true,
        verticalSpacing: "md",
        horizontalSpacing: "md",
      },
      styles: {
        table: {
          borderCollapse: "collapse",
        },
        th: {
          fontSize: "0.8125rem",
          fontWeight: 600,
          color: "var(--qb-text-secondary)",
          borderBottom: "1px solid var(--qb-separator)",
          paddingBlock: "14px",
        },
        td: {
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: "var(--qb-text-primary)",
          borderBottom: "1px solid var(--qb-separator)",
          paddingBlock: "16px",
        },
        tr: {
          borderColor: "var(--qb-separator)",
        },
      },
    },
    Badge: {
      defaultProps: {
        radius: "xl",
        fw: 600,
      },
    },
    Switch: {
      defaultProps: {
        size: "md",
        color: "brand",
      },
    },
    Tabs: {
      defaultProps: {
        radius: "md",
      },
      styles: {
        tab: {
          minHeight: "44px",
          fontWeight: 600,
          fontSize: "0.9375rem",
          paddingInline: "20px",
        },
      },
    },
    Alert: {
      defaultProps: {
        radius: "lg",
      },
    },
  },
});
