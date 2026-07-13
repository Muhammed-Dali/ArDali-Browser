#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedLicense = 'GPL-3.0-only';
const includeAur = process.argv.includes('--include-aur');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(`[verify-release-metadata] ${message}`);
  process.exitCode = 1;
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const version = packageJson.version;
const electronVersion = packageJson.build?.electronVersion;

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`invalid application version: ${version}`);
if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
  fail(`package-lock version does not match package.json (${version})`);
}
if (packageJson.license !== expectedLicense || packageLock.packages?.['']?.license !== expectedLicense) {
  fail(`root package license must be ${expectedLicense}`);
}
if (packageJson.devDependencies?.electron !== electronVersion) {
  fail(`Electron dependency ${packageJson.devDependencies?.electron} does not match build.electronVersion ${electronVersion}`);
}

const repositoryUrl = packageJson.repository?.url || '';
if (!repositoryUrl.includes('Muhammed-Dali/ArDali-WebMedia')) fail(`unexpected repository URL: ${repositoryUrl}`);
if (packageJson.build?.publish?.owner !== 'Muhammed-Dali' || packageJson.build?.publish?.repo !== 'ArDali-WebMedia') {
  fail('electron-builder publish target is not Muhammed-Dali/ArDali-WebMedia');
}

const aurPkgbuild = read('packaging/aur/ardali-bin/PKGBUILD');
const aurSrcinfo = read('packaging/aur/ardali-bin/.SRCINFO');
const rpmSpec = read('packaging/rpm/ardali-media-player.spec');
const debianControl = read('packaging/debian/control');
const appstream = read('packaging/appstream/com.ardali.mediaplayer.metainfo.xml');

const requiredPatterns = [
  ['AUR PKGBUILD license', aurPkgbuild, /license=\('GPL-3\.0-only'\)/],
  ['AUR PKGBUILD checksum', aurPkgbuild, /^sha256sums=\('[0-9a-f]{64}'\)$/m],
  ['AUR .SRCINFO license', aurSrcinfo, /^\s*license = GPL-3\.0-only$/m],
  ['RPM version', rpmSpec, new RegExp(`^Version:\\s+${version.replace(/\./g, '\\.')}$$`, 'm')],
  ['RPM license', rpmSpec, /^License:\s+GPL-3\.0-only$/m],
  ['Debian version', debianControl, new RegExp(`^Version: ${version.replace(/\./g, '\\.')}$$`, 'm')],
  ['AppStream license', appstream, /<project_license>GPL-3\.0-only<\/project_license>/],
  ['AppStream release', appstream, new RegExp(`<release version="${version.replace(/\./g, '\\.')}"`)]
];

if (includeAur) {
  requiredPatterns.push(
    ['AUR PKGBUILD version', aurPkgbuild, new RegExp(`^pkgver=${version.replace(/\./g, '\\.')}$$`, 'm')],
    ['AUR .SRCINFO version', aurSrcinfo, new RegExp(`^\\s*pkgver = ${version.replace(/\./g, '\\.')}$$`, 'm')]
  );
}

for (const [label, content, pattern] of requiredPatterns) {
  if (!pattern.test(content)) fail(`${label} is inconsistent`);
}

if (!process.exitCode) {
  console.log(`[verify-release-metadata] PASS version=${version} license=${expectedLicense} electron=${electronVersion} aur=${includeAur ? 'required' : 'deferred'}`);
}
