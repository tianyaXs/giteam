import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = dirname(scriptDir);

await run("npx", ["tsc", "-p", "tsconfig.json"]);
await run("npx", ["vite", "build"], {
  env: {
    ...process.env,
    BUILD_TARGET: "web"
  }
});

await copyFile(join(desktopDir, "dist-web", "web.html"), join(desktopDir, "dist-web", "index.html"));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktopDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}
