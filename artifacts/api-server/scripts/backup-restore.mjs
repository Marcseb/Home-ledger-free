import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { previewArchive, restoreArchive } from "../src/lib/recovery.ts";

async function hiddenPhrase() {
  if (!stdin.isTTY) throw new Error("Restore requires an interactive terminal for hidden recovery-phrase entry");
  stdout.write("Recovery phrase (input hidden): ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let phrase = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("No recovery phrase was entered"));
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Restore cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          stdout.write("\n");
          cleanup();
          resolve(phrase);
          return;
        }
        if (character === "\u007f" || character === "\b") phrase = phrase.slice(0, -1);
        else phrase += character;
      }
    };
    stdin.on("data", onData);
    stdin.once("end", onEnd);
  });
}

const terminal = readline.createInterface({ input: stdin, output: stdout });
try {
  const archivePath = (await terminal.question("Path to .hlbackup archive: ")).trim();
  if (!archivePath) throw new Error("Archive path is required");
  terminal.close();
  const phrase = await hiddenPhrase();
  const preview = previewArchive(archivePath, phrase);
  stdout.write("\nValidated recovery archive:\n");
  stdout.write(`  Household: ${preview.household}\n  Archive date: ${preview.createdAt}\n  Record counts: ${JSON.stringify(preview.counts)}\n`);
  const confirmationPrompt = readline.createInterface({ input: stdin, output: stdout });
  let confirmation;
  try {
    confirmation = await confirmationPrompt.question("\nType RESTORE to install on this new/empty server: ");
  } finally {
    confirmationPrompt.close();
  }
  if (confirmation !== "RESTORE") throw new Error("Restore was not confirmed");
  restoreArchive(archivePath, phrase);
  stdout.write("Restore completed. The live SQLite database remains plaintext at rest; protect the server's storage. Start Home Ledger to open the household.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Restore failed"}\n`);
  process.exitCode = 1;
} finally {
  terminal.close();
}