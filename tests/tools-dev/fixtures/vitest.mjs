// Stands in for a vitest run. The file is named vitest.mjs because that is the name the memguard
// looks for. Arguments: <extra MB held by this process> [extra MB held by one worker child].
// The memory is filled, so it shows in the resident size that ps reports.
import { spawn } from "node:child_process";

const ownMb = Number(process.argv[2] || 0);
const childMb = Number(process.argv[3] || 0);
const held = ownMb > 0 ? Buffer.alloc(ownMb * 1024 * 1024, 1) : null;

let child = null;
if (childMb > 0) {
  const code = `const b = Buffer.alloc(${childMb} * 1024 * 1024, 1); setInterval(() => b.length, 1000);`;
  child = spawn(process.execPath, ["-e", code], { stdio: "ignore" });
}

// A real run stops its workers when it is stopped; do the same so no orphan is left behind.
process.on("SIGTERM", () => {
  if (child) child.kill("SIGTERM");
  process.exit(0);
});
setInterval(() => held && held.length, 1000);
