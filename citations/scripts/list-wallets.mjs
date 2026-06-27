import { listWallets } from "./wallet-keystore.mjs";

const wallets = await listWallets();

console.log(JSON.stringify({ wallets }, null, 2));
