import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error("A command is required.");
}

const localEnv = Object.fromEntries(
  readFileSync(resolve(".env.local"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const useWindowsCommandShim = process.platform === "win32" && command === "pnpm";
const executable = useWindowsCommandShim ? (process.env.ComSpec ?? "cmd.exe") : command;
const commandArgs = useWindowsCommandShim
  ? [
      "/d",
      "/s",
      "/c",
      [command, ...args]
        .map((value) => {
          if (!/^[A-Za-z0-9_@./:\\=-]+$/u.test(value)) {
            throw new Error(`Unsupported character in Windows command argument: ${value}`);
          }
          return value;
        })
        .join(" "),
    ]
  : args;
const result = spawnSync(executable, commandArgs, {
  cwd: process.cwd(),
  env: { ...process.env, ...localEnv },
  shell: false,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
