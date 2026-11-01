import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    sure: { baseUrl: string; readWriteKey: string; readKey: string };
  }
}

const PROJECT = "trifles-contract";
const COMPOSE_FILE = fileURLToPath(new URL("./compose.yml", import.meta.url));
const SPEC_README = fileURLToPath(new URL("../../spec/README.md", import.meta.url));
const READ_WRITE_KEY = "contract-read-write-key";
const READ_KEY = "contract-read-key";

/** Starts the Sure commit pinned in spec/README.md, seeds it, and removes it after the run. */
export default function setup(project: TestProject) {
  const commit = pinnedCommit();
  const port = process.env.SURE_CONTRACT_PORT ?? "3999";
  const env = { ...process.env, SURE_IMAGE_TAG: `sha-${commit}`, SURE_CONTRACT_PORT: port };
  const compose = (...args: string[]) =>
    execFileSync("docker", ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args], {
      env,
      stdio: "inherit",
    });

  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });
  } catch {
    throw new Error("The contract suite needs Docker: `docker version` failed.");
  }

  // A stack kept by KEEP_SURE=1 already holds the seed, which cannot run twice.
  compose("down", "-v");
  compose("up", "-d", "--wait", "--wait-timeout", "600");
  compose(
    "exec",
    "-T",
    "-e",
    `SURE_READ_WRITE_KEY=${READ_WRITE_KEY}`,
    "-e",
    `SURE_READ_KEY=${READ_KEY}`,
    "web",
    "bin/rails",
    "runner",
    "/contract/seed.rb",
  );

  project.provide("sure", {
    baseUrl: `http://127.0.0.1:${port}`,
    readWriteKey: READ_WRITE_KEY,
    readKey: READ_KEY,
  });

  return () => {
    if (process.env.KEEP_SURE === "1") {
      console.info(
        `KEEP_SURE=1: Sure keeps running on port ${port} (docker compose -p ${PROJECT})`,
      );
      return;
    }
    compose("down", "-v");
  };
}

function pinnedCommit() {
  const commits = readFileSync(SPEC_README, "utf8").match(/`[0-9a-f]{40}`/g) ?? [];
  if (commits.length !== 1) {
    throw new Error(`spec/README.md must pin exactly one Sure commit, found ${commits.length}`);
  }
  return commits[0]!.slice(1, -1);
}
