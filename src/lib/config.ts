export const APERTURE_IMMICH_API_BASE_URL =
  process.env.APERTURE_IMMICH_API_BASE_URL ?? "http://127.0.0.1:2283/api";

export const APERTURE_ACCESS_LOG =
  process.env.APERTURE_ACCESS_LOG ?? "/var/log/nginx/access.log";

export const APERTURE_LICENSE_FEE_ATOMIC_USDC = Number.parseInt(
  process.env.APERTURE_LICENSE_FEE_ATOMIC_USDC ?? "2500",
  10,
);

if (!Number.isFinite(APERTURE_LICENSE_FEE_ATOMIC_USDC)) {
  throw new Error("APERTURE_LICENSE_FEE_ATOMIC_USDC must be a number.");
}
