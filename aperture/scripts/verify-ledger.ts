import { readLicenseLedger, verifyLicenseLedger } from "../src/lib/ledger";

async function main() {
  const ledger = await readLicenseLedger();
  const verification = verifyLicenseLedger(ledger);
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.ok) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
