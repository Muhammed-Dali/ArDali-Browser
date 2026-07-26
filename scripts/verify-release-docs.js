#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseNotesPath = `docs/RELEASE_NOTES_v${version}.md`;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(relativePath, text, label = text) {
  if (!read(relativePath).includes(text)) {
    throw new Error(`${relativePath} is missing ${label}`);
  }
}

requireText("README.md", `Download v${version}`, "current download version");
requireText("README.md", `## What's New in v${version}`, "current What's New heading");
for (const feature of [
  "Password Manager",
  "Music",
  "Video",
  "Gallery",
  "Browser",
  "Downloads",
  "Audio Effects",
  "Screen Recorder",
  "Song Finder",
  "Ad Block",
  "Workspace Tabs",
  "ProjectM",
  "Localization"
]) {
  requireText("README.md", feature, `feature: ${feature}`);
}

requireText("index.html", `<div class="about-subtitle">v${version}</div>`, "About version");
requireText("index.html", `What's new in v${version}`, "About What's New version");
for (const metadata of [
  "aboutAppVersionValue",
  "aboutElectronVersionValue",
  "aboutChromiumVersionValue",
  "aboutNodeVersionValue",
  "GPL-3.0-only",
  "aboutGithubBtn",
  "© 2026 Muhammet Dali"
]) {
  requireText("index.html", metadata, `About metadata: ${metadata}`);
}

if (!fs.existsSync(path.join(root, releaseNotesPath))) {
  throw new Error(`missing ${releaseNotesPath}`);
}
for (const heading of ["## New", "## Improved", "## Fixed", "## Performance", "## Security"]) {
  requireText(releaseNotesPath, heading);
}

requireText("CHANGELOG.md", `## [${version}]`, "current changelog version");
requireText(
  "packaging/appstream/com.ardali.mediaplayer.metainfo.xml",
  `<release version="${version}"`,
  "current AppStream release"
);

console.log(`[verify-release-docs] PASS version=${version} notes=${releaseNotesPath}`);
