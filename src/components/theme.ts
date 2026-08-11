// Light theme, sky-blue accent. The camera-overlay elements (anything that
// sits on top of the live video — calibration/result overlays, the boss
// card, the camera-switch button, the skeleton) keep a dark translucent
// background with white/bright-accent foreground regardless of this theme,
// since they need to stay legible over arbitrary video content rather than
// match the page chrome.
export const ACCENT = '#0EA5E9'; // sky-500 — page chrome (buttons, active tab, brand text on light bg)
export const ACCENT_ON_DARK = '#38BDF8'; // sky-400 — same role, but on the dark video overlays
export const TEXT_PRIMARY = '#0F172A';
export const TEXT_MUTED = '#64748B';
export const TEXT_ON_ACCENT = '#FFFFFF';
