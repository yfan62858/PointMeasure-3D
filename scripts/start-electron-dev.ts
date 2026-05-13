import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development"
};

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env
});

function stopChild(): void {
  if (!child.killed) {
    child.kill();
  }
}

process.on("SIGINT", () => {
  stopChild();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopChild();
  process.exit(143);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
