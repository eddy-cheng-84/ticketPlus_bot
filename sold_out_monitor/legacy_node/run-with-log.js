import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const [, , logFileName = "monitor.log", ...commandArgs] = process.argv;

if (commandArgs.length === 0) {
  console.error("Usage: node run-with-log.js <log-file> <command> [args...]");
  process.exit(1);
}

const logDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logDir, { recursive: true });

const logPath = path.join(logDir, logFileName);
const logStream = fs.createWriteStream(logPath, { flags: "a" });
const child = spawn(commandArgs[0], commandArgs.slice(1), {
  cwd: process.cwd(),
  stdio: ["inherit", "pipe", "pipe"],
  shell: false,
});

const startLine = `[${new Date().toLocaleString("sv-SE", { hour12: false })}] ${commandArgs.join(" ")}\n`;
process.stdout.write(startLine);
logStream.write(startLine);

function forward(stream, target) {
  stream.on("data", (chunk) => {
    target.write(chunk);
    logStream.write(chunk);
  });
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

child.on("close", (code) => {
  logStream.end(() => process.exit(code ?? 0));
});
