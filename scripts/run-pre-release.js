"use strict";

const { spawnSync } = require("node:child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  ["npm audit", ["audit"]],
  ["npm ls", ["ls", "--all"]],
  ["verify:libs", ["run", "-s", "verify:libs"]],
  ["verify:binary:manifest", ["run", "-s", "verify:binary:manifest"]],
  ["verify:release:metadata", ["run", "-s", "verify:release:metadata"]],
  ["verify:release:docs", ["run", "-s", "verify:release:docs"]],
  ["test:electron-security", ["run", "-s", "test:electron-security"]],
  ["test:credential-vault", ["run", "-s", "test:credential-vault"]],
  ["test:tab-architecture", ["run", "-s", "test:tab-architecture"]],
  ["test:projectm-window", ["run", "-s", "test:projectm-window"]],
  ["test:audio-effects-startup", ["run", "-s", "test:audio-effects-startup"]],
  ["dali:test:security", ["run", "-s", "dali:test:security"]],
];

console.log(`\n[PRE-RELEASE] Running ${checks.length} required checks sequentially\n`);

for (const [name, args] of checks) {
  console.log(`[PRE-RELEASE] RUN  ${name}`);
  const result = spawnSync(npm, args, { stdio: "inherit", shell: false });

  if (result.error) {
    console.error(`[PRE-RELEASE] FAIL ${name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    console.error(`[PRE-RELEASE] FAIL ${name}: ${reason}`);
    process.exit(result.status || 1);
  }

  console.log(`[PRE-RELEASE] PASS ${name}\n`);
}

console.log(`[PRE-RELEASE] PASS ${checks.length}/${checks.length} checks completed`);
