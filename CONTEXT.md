# Pi TUI

The terminal interaction language shared by Pi's regular and fullscreen interfaces.

## Language

**Transcript Viewport**:
The scrollable region that presents the conversation transcript in fullscreen mode. It does not participate in keyboard focus.
_Avoid_: Transcript focus, viewport focus

**Viewport Navigation**:
Interactions that move the Transcript Viewport independently of the focused input component, including keyboard commands, mouse-wheel input, and scrollbar manipulation. They are suspended while a Capturing Overlay is active.
_Avoid_: Editor scrolling

**Editor Navigation**:
Commands that move the cursor or visible page within the focused editor without moving the Transcript Viewport.
_Avoid_: Viewport scrolling

**Capturing Overlay**:
A visible overlay that temporarily owns keyboard focus and suspends interaction with the underlying transcript and editor. Becoming active cancels any in-progress Viewport Navigation gesture.
_Avoid_: Background modal
