# Keep the Transcript Viewport outside keyboard focus

The fullscreen Transcript Viewport remains outside the keyboard focus model. Viewport Navigation uses dedicated global bindings and is suspended while a Capturing Overlay is active; this avoids adding focus transitions or a handled/unhandled input protocol solely to arbitrate viewport and editor navigation.
