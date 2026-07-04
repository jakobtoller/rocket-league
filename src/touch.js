// Shared touch-input state. Written by the on-screen joystick,
// read by the engine (local play) and the net client (LAN play).
// Plain module so it is safe to import in Node too.
export const touchState = {
  active: false,   // joystick currently held
  dx: 0,           // direction, normalized -1..1 (screen coords, y down)
  dy: 0,
  mag: 0,          // 0..1 stick deflection
  boost: false,
};

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
