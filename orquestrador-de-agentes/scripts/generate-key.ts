import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64url");
console.log("Nova ENCRYPTION_KEY (32 bytes, base64url):\n");
console.log(key);
console.log("\nAdicione ao .env:\n");
console.log(`ENCRYPTION_KEY=${key}`);
