// Conversion factors
const MPH_TO_MS = 0.44704;
const KMH_TO_MS = 1 / 3.6;
const RPM_TO_RADS = (2 * Math.PI) / 60;

// --- Linear velocity conversions (to m/s) ---

/** Miles per hour → meters per second */
export function mphToMs(mph: number): number { return mph * MPH_TO_MS; }

/** Kilometers per hour → meters per second */
export function kmhToMs(kmh: number): number { return kmh * KMH_TO_MS; }

// --- Linear velocity conversions (from m/s) ---

/** Meters per second → miles per hour */
export function msToMph(ms: number): number { return ms / MPH_TO_MS; }

/** Meters per second → kilometers per hour */
export function msToKmh(ms: number): number { return ms / KMH_TO_MS; }

// --- Angular velocity conversions ---

/** Revolutions per minute → radians per second */
export function rpmToRadS(rpm: number): number { return rpm * RPM_TO_RADS; }

/** Radians per second → revolutions per minute */
export function radSToRpm(radS: number): number { return radS / RPM_TO_RADS; }
