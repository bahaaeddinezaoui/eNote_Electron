// The application's type collection, kept in one place for both processes.
//
// Three roles, never a fourth: Instrument Sans carries the interface, Instrument
// Serif carries display, JetBrains Mono carries identifiers and figures. Noto
// Naskh Arabic rides along in every stack so Arabic text is shaped by a member
// of the collection instead of whatever the machine happens to have installed.
//
// The renderer resolves the very same stacks through the CSS variables in
// index.css and loads the families from the bundled files declared in
// fonts.css. This module is what the printed reports build with, so a screen and
// a printed page cannot drift apart. Changing a family means editing this file,
// fonts.css and the font files — nothing else in the project names a typeface.
export const FONT_COLLECTION = {
  sans: "'Instrument Sans', 'Noto Naskh Arabic', 'Helvetica Neue', sans-serif",
  serif: "'Instrument Serif', 'Noto Naskh Arabic', 'Iowan Old Style', serif",
  mono: "'JetBrains Mono', 'Noto Naskh Arabic', 'SFMono-Regular', Consolas, monospace"
}
