/**
 * The OpenTUI boundary.
 *
 * ⚠ THIS DIRECTORY IS THE ONLY PLACE THAT MAY IMPORT `@opentui/*`.
 *
 * OpenTUI is pre-1.0 and ships breaking changes regularly. Funnelling every
 * import through here means an upgrade is a contained fix in one directory
 * rather than a hunt across the whole client. Screens import hooks and the
 * renderer from this module, never from the library directly.
 *
 * The one unavoidable exception is JSX itself: `<box>` and `<text>` resolve
 * through `jsxImportSource: "@opentui/react"` in packages/tui/tsconfig.json.
 * That is a single config line, so it stays a single point of change too.
 */

export {
  useKeyboard,
  useTerminalDimensions,
  useTimeline,
  useRenderer,
  createRoot,
} from '@opentui/react';

export { createCliRenderer } from '@opentui/core';

export type { CliRenderer, KeyEvent } from '@opentui/core';
