const {execSync} = require("child_process");
const {
	createWriteStream,
	existsSync,
	mkdirSync,
	promises,
	readFileSync,
} = require("fs");
const https = require("https");
const {homedir, platform} = require("os");
const {join} = require("path");

const FFMPEG_STORAGE_KEY = "ffmpegPath";
const WINDOWS_FFMPEG_ZIP_URL =
	"https://github.com/aandrew-me/ffmpeg-builds/releases/download/v8/ffmpeg_win64.zip";

function getLocalStorageItem(key) {
	if (typeof localStorage === "undefined") return "";
	return localStorage.getItem(key) || "";
}

function setLocalStorageItem(key, value) {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(key, value);
}

function getBundledFfmpegExecutablePath() {
	return join(
		__dirname,
		"..",
		"ffmpeg",
		"bin",
		platform() === "win32" ? "ffmpeg.exe" : "ffmpeg"
	);
}

function getManagedFfmpegExecutablePath() {
	return join(
		homedir(),
		".aurivo-dawlod",
		platform() === "win32" ? "ffmpeg.exe" : "ffmpeg"
	);
}

function resolveFfmpegPathSync() {
	const ffmpegEnvPath =
		process.env.AURIVO_FFMPEG_PATH ||
		process.env.YTDOWNLOADER_FFMPEG_PATH;
	if (ffmpegEnvPath) {
		if (existsSync(ffmpegEnvPath)) {
			return ffmpegEnvPath;
		}
		throw new Error(
			"AURIVO_FFMPEG_PATH/YTDOWNLOADER_FFMPEG_PATH is set, but no file exists there."
		);
	}

	const storedPath = getLocalStorageItem(FFMPEG_STORAGE_KEY);
	if (storedPath && existsSync(storedPath)) {
		return storedPath;
	}

	const managedPath = getManagedFfmpegExecutablePath();
	if (existsSync(managedPath)) {
		setLocalStorageItem(FFMPEG_STORAGE_KEY, managedPath);
		return managedPath;
	}

	try {
		if (platform() === "win32") {
			const ffmpegWinPath = execSync("where.exe ffmpeg")
				.toString()
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);
			if (ffmpegWinPath && existsSync(ffmpegWinPath)) {
				return ffmpegWinPath;
			}
		} else {
			const ffmpegPath = execSync("which ffmpeg").toString().trim();
			if (ffmpegPath && existsSync(ffmpegPath)) {
				return ffmpegPath;
			}
		}
	} catch {
		// Continue to bundled checks.
	}

	const bundledPath = getBundledFfmpegExecutablePath();
	if (existsSync(bundledPath)) {
		return bundledPath;
	}

	return "";
}

async function ensureFfmpegPath(options = {}) {
	const {
		autoInstallOnWindows = false,
		onStatus = () => {},
		onProgress = () => {},
		onError = () => {},
	} = options;

	const resolvedPath = resolveFfmpegPathSync();
	if (resolvedPath) return resolvedPath;

	if (!(autoInstallOnWindows && platform() === "win32")) {
		return "";
	}

	const hiddenDir = join(homedir(), ".aurivo-dawlod");
	const zipPath = join(hiddenDir, "ffmpeg_win64.zip");
	const extractDir = join(hiddenDir, "ffmpeg_extract");
	const finalExePath = getManagedFfmpegExecutablePath();

	mkdirSync(hiddenDir, {recursive: true});
	onStatus("FFmpeg indiriliyor. Lütfen bekleyin.");

	try {
		await downloadFileWithProgress(WINDOWS_FFMPEG_ZIP_URL, zipPath, onProgress);

		const escapedZip = zipPath.replace(/'/g, "''");
		const escapedDest = extractDir.replace(/'/g, "''");
		execSync(
			`powershell -NoProfile -Command "Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`
		);

		const extractedFfmpeg = await findFileRecursive(extractDir, "ffmpeg.exe");
		if (!extractedFfmpeg) {
			throw new Error("ffmpeg.exe extracted file not found.");
		}

		await promises.copyFile(extractedFfmpeg, finalExePath);
		setLocalStorageItem(FFMPEG_STORAGE_KEY, finalExePath);
		return finalExePath;
	} catch (error) {
		onError(error);
		return "";
	} finally {
		onProgress(0);
		try {
			await promises.rm(zipPath, {force: true});
			await promises.rm(extractDir, {recursive: true, force: true});
		} catch {
			// Ignore temp cleanup errors.
		}
	}
}

function downloadFileWithProgress(
	url,
	destinationPath,
	onProgress,
	redirectCount = 0
) {
	return new Promise((resolve, reject) => {
		const request = https.get(url, (response) => {
			const statusCode = response.statusCode || 0;
			const location = response.headers.location;
			if (
				[301, 302, 303, 307, 308].includes(statusCode) &&
				location &&
				redirectCount < 5
			) {
				response.resume();
				downloadFileWithProgress(
					location,
					destinationPath,
					onProgress,
					redirectCount + 1
				)
					.then(resolve)
					.catch(reject);
				return;
			}

			if (statusCode !== 200) {
				reject(new Error(`Download failed. HTTP status: ${statusCode}`));
				return;
			}

			const totalBytes = Number(response.headers["content-length"] || 0);
			let downloadedBytes = 0;

			const fileStream = createWriteStream(destinationPath);
			response.on("data", (chunk) => {
				downloadedBytes += chunk.length;
				if (totalBytes > 0) {
					onProgress(downloadedBytes / totalBytes);
				}
			});

			response.pipe(fileStream);
			fileStream.on("finish", () => {
				fileStream.close(() => resolve(destinationPath));
			});
			fileStream.on("error", (streamError) => {
				fileStream.close(() => reject(streamError));
			});
		});

		request.on("error", (error) => reject(error));
	});
}

async function findFileRecursive(dirPath, filename) {
	const stack = [dirPath];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		const entries = await promises.readdir(current, {withFileTypes: true});
		for (const entry of entries) {
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase() === filename) {
				return fullPath;
			}
		}
	}
	return "";
}

module.exports = {
	ensureFfmpegPath,
	resolveFfmpegPathSync,
	FFMPEG_STORAGE_KEY,
	getLinuxFfmpegInstallHint,
	getLinuxFfmpegInstallInfo,
};

function getLinuxFfmpegInstallHint() {
	const info = getLinuxFfmpegInstallInfo();
	return info ? info.primary : null;
}

function getLinuxFfmpegInstallInfo() {
	if (platform() !== "linux") return null;

	const osRelease = readOsRelease();
	const id = (osRelease.ID || "").toLowerCase();
	const idLike = (osRelease.ID_LIKE || "").toLowerCase();
	const tags = `${id} ${idLike}`;

	if (includesAny(tags, ["ubuntu", "debian", "mint", "pop"])) {
		return {
			family: "debian",
			primary: "sudo apt update && sudo apt install -y ffmpeg",
			autoInstall: "apt update && apt install -y ffmpeg",
		};
	}
	if (
		includesAny(tags, [
			"fedora",
			"rhel",
			"centos",
			"rocky",
			"almalinux",
		])
	) {
		return {
			family: "fedora",
			primary: "sudo dnf install -y ffmpeg",
			autoInstall: "dnf install -y ffmpeg",
		};
	}
	if (includesAny(tags, ["arch", "manjaro", "endeavouros"])) {
		return {
			family: "arch",
			primary: "sudo pacman -S --needed ffmpeg",
			alternate: "yay -S ffmpeg",
			autoInstall: "pacman -Sy --noconfirm ffmpeg",
		};
	}
	if (includesAny(tags, ["opensuse", "suse"])) {
		return {
			family: "suse",
			primary: "sudo zypper install -y ffmpeg",
			autoInstall: "zypper --non-interactive install ffmpeg",
		};
	}
	if (includesAny(tags, ["alpine"])) {
		return {
			family: "alpine",
			primary: "sudo apk add ffmpeg",
			autoInstall: "apk add ffmpeg",
		};
	}

	return {
		family: "other",
		primary: "Paket yoneticiniz ile ffmpeg kurun (ornek: apt/dnf/pacman/zypper).",
		autoInstall: "",
	};
}

function readOsRelease() {
	try {
		const raw = readFileSync("/etc/os-release", "utf8");
		const map = {};
		raw.split("\n").forEach((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
				return;
			}
			const idx = trimmed.indexOf("=");
			const key = trimmed.slice(0, idx);
			const value = trimmed
				.slice(idx + 1)
				.replace(/^"/, "")
				.replace(/"$/, "");
			map[key] = value;
		});
		return map;
	} catch {
		return {};
	}
}

function includesAny(text, words) {
	return words.some((word) => text.includes(word));
}
