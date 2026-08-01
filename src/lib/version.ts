import packageJson from '../../package.json';

// Single source of truth for the displayed application version. Resolved at
// build time from package.json — do not duplicate this literal elsewhere.
// Server-only by convention: pass APP_VERSION down as a prop rather than
// importing this from a 'use client' module, so no build metadata beyond the
// semver string reaches the client bundle.
export const APP_VERSION: string = packageJson.version;
