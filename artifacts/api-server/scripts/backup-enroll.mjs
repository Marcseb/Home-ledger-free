import { enrollRecovery, getKeyringPath } from "../src/lib/recovery.ts";

try {
  const phrase = enrollRecovery();
  process.stdout.write("Recovery enrollment complete. Save this phrase offline; it will not be shown again:\n\n");
  process.stdout.write(`${phrase}\n\n`);
  process.stdout.write(`Private server keyring: ${getKeyringPath()}\n`);
  process.stdout.write("The live SQLite database remains plaintext at rest; protect the server's storage separately.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Recovery enrollment failed"}\n`);
  process.exitCode = 1;
}