/** Physics simulation steps per second */
export const SERVER_TICK_RATE = 60;

/** State updates sent to clients per second */
export const BROADCAST_RATE = 20;

/** Client inputs sent to server per second */
export const CLIENT_INPUT_RATE = 60;

/** Maximum frames of input history kept in buffer */
export const MAX_INPUT_BUFFER = 120;

/** Position interpolation blend factor (0-1) */
export const POSITION_LERP_SPEED = 0.3;

/** Rotation interpolation blend factor (0-1) */
export const ROTATION_SLERP_SPEED = 0.3;

/** Fixed timestep in seconds derived from tick rate */
export const FIXED_TIMESTEP = 1 / SERVER_TICK_RATE;

/** Ticks between state broadcasts */
export const BROADCAST_INTERVAL = Math.round(SERVER_TICK_RATE / BROADCAST_RATE);

/** Clock sync request interval in milliseconds */
export const CLOCK_SYNC_INTERVAL_MS = 3000;

/** Number of clock sync samples to keep for rolling average */
export const CLOCK_SYNC_SAMPLES = 10;

/** Position error threshold before correction is applied */
export const RECONCILIATION_THRESHOLD = 0.1;

/** Number of snapshots buffered for interpolation */
export const INTERPOLATION_BUFFER_SIZE = 3;

/** Default server port */
export const DEFAULT_PORT = 8080;
