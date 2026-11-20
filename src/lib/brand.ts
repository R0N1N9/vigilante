/**
 * The Vigilance Suite: one codebase, three apps. Vigilance is the desktop app (Mac, Linux, Windows; R0N1N9/vigilance),
 * Vigilante is the live web app and Field Agent phone app (R0N1N9/vigilante, GitHub Pages), and
 * Vigil is the Android app (R0N1N9/vigil). The web build sets VITE_WEB, so it shows the web name.
 * Only names people see change: protocol tags and storage keys stay the same across all three.
 */
export const DESKTOP_NAME = 'Vigilance';
export const WEB_NAME = 'Vigilante';
export const APP = import.meta.env.VITE_WEB ? WEB_NAME : DESKTOP_NAME;
export const APP_UPPER = APP.toUpperCase();
/** The umbrella name for all three apps. */
export const SUITE = 'Vigilance Suite';
export const SUITE_APPS = 'Vigilance (desktop), Vigilante (web and phone) and Vigil (Android)';
