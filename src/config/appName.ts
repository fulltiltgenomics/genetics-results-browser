// product/brand name, configurable per deployment via VITE_APP_NAME (build-time);
// defaults to "FinnGenie" so dev and unconfigured builds keep current behavior
export const APP_NAME = import.meta.env.VITE_APP_NAME || "FinnGenie";
