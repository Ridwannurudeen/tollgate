import {
  APERTURE_IMMICH_API_BASE_URL,
  APERTURE_LICENSE_FEE_ATOMIC_USDC,
} from "../src/lib/config";
import { processAccessLogLine } from "../src/lib/watcher";

const demoLine = process.env.APERTURE_DEMO_ACCESS_LOG_LINE;

async function main() {
  if (!demoLine) {
    throw new Error(
      "APERTURE_DEMO_ACCESS_LOG_LINE is required for prove:demo-resolve.",
    );
  }

  const result = await processAccessLogLine(demoLine, {
    immichApiBaseUrl: APERTURE_IMMICH_API_BASE_URL,
    amountAtomicUsdc: APERTURE_LICENSE_FEE_ATOMIC_USDC,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
