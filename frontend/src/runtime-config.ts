export const DEFAULT_BACKEND_URL = "https://testhyundai.devmultid.org";

export function testToolsEnabled(): boolean {
  if (window.ParkIQNative) return window.ParkIQNative.isTestBuild?.() === true;
  return import.meta.env.VITE_ENABLE_TEST_TOOLS === "true";
}
