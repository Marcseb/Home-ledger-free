/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#1d3329',
    tint: '#d96d5f',

    // Core surfaces
    background: '#f6f0e6',
    foreground: '#1d3329',

    // Cards / elevated surfaces
    card: '#fffaf2',
    cardForeground: '#1d3329',

    // Primary action color (buttons, links, active states)
    primary: '#1d5b42',
    primaryForeground: '#fffaf2',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e8dfd1',
    secondaryForeground: '#315443',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ebe2d6',
    mutedForeground: '#6c786f',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f3c4b9',
    accentForeground: '#713d35',

    // Destructive actions (delete, error states)
    destructive: '#bd5047',
    destructiveForeground: '#fffaf2',

    // Balance-chart fills contrast with their track and with the card.
    balanceTrack: '#153f30',
    positiveBar: '#a3f0b0',
    negativeBar: '#ffa393',
    historySeries: ['#3c6c9a', '#8b65a8', '#a5743e', '#438b8f', '#9a617b', '#647e51'],

    // Borders and input outlines
    border: '#d8cdbd',
    input: '#cbbfad',
  },
  dark: {
    text: '#f6f0e6',
    tint: '#f09a88',
    background: '#12231b',
    foreground: '#f6f0e6',
    card: '#1b3328',
    cardForeground: '#f6f0e6',
    primary: '#a9d5bb',
    primaryForeground: '#12231b',
    secondary: '#274637',
    secondaryForeground: '#e1f1e5',
    muted: '#203b2d',
    mutedForeground: '#adc0b3',
    accent: '#70433c',
    accentForeground: '#ffd9cf',
    destructive: '#f09a88',
    destructiveForeground: '#251410',
    balanceTrack: '#e6f1e4',
    positiveBar: '#0b6844',
    negativeBar: '#a93e36',
    historySeries: ['#9ac5ed', '#c6a2e3', '#e7bd86', '#8dd4d1', '#e7a8c5', '#c1d39e'],
    border: '#345242',
    input: '#466451',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 14,
};

export default colors;
