const {shell, ipcRenderer, clipboard} = require("electron");
const {default: YTDlpWrap} = require("yt-dlp-wrap-plus");
const {constants} = require("fs/promises");
const {homedir, platform} = require("os");
const {join} = require("path");
const {mkdirSync, accessSync, promises, existsSync} = require("fs");
const {execSync, spawn} = require("child_process");
const {
	ensureFfmpegPath,
	getLinuxFfmpegInstallInfo,
} = require("../src/ffmpeg-manager");

const CONSTANTS = {
	DOM_IDS: {
		// Main UI
		LOADING_WRAPPER: "loadingWrapper",
		INCORRECT_MSG: "incorrectMsg",
		ERROR_BTN: "errorBtn",
		ERROR_DETAILS: "errorDetails",
		PATH_DISPLAY: "path",
		SELECT_LOCATION_BTN: "selectLocation",
		DOWNLOAD_LIST: "list",
		CLEAR_BTN: "clearBtn",
		// Hidden Info Panel
		HIDDEN_PANEL: "hidden",
		CLOSE_HIDDEN_BTN: "closeHidden",
		TITLE_CONTAINER: "title",
		TITLE_INPUT: "titleName",
		URL_INPUTS: ".url",
		AUDIO_PRESENT_SECTION: "audioPresent",
		QUIT_APP_BTN: "quitAppBtn",
		// Format Selectors
		VIDEO_FORMAT_SELECT: "videoFormatSelect",
		AUDIO_FORMAT_SELECT: "audioFormatSelect",
		AUDIO_FOR_VIDEO_FORMAT_SELECT: "audioForVideoFormatSelect",
		// Download Buttons
		VIDEO_DOWNLOAD_BTN: "videoDownload",
		AUDIO_DOWNLOAD_BTN: "audioDownload",
		EXTRACT_BTN: "extractBtn",
		// Audio Extraction
		EXTRACT_SELECTION: "extractSelection",
		EXTRACT_QUALITY_SELECT: "extractQualitySelect",
		// Advanced Options
		CUSTOM_ARGS_INPUT: "customArgsInput", // Add this line
		START_TIME: "min-time",
		END_TIME: "max-time",
		MIN_SLIDER: "min-slider",
		MAX_SLIDER: "max-slider",
		SLIDER_RANGE_HIGHLIGHT: "range-highlight",
		SUB_CHECKED: "subChecked",
		QUIT_CHECKED: "quitChecked",
		// Popups
		POPUP_BOX: "popupBox",
		POPUP_BOX_MAC: "popupBoxMac",
		POPUP_TEXT: "popupText",
		POPUP_SVG: "popupSvg",
		YTDLP_DOWNLOAD_PROGRESS: "ytDlpDownloadProgress",
		UPDATE_POPUP: "updatePopup",
		UPDATE_POPUP_PROGRESS: "updateProgress",
		UPDATE_POPUP_BAR: "progressBarFill",
		STARTUP_SPLASH: "startupSplash",
		// Menu
		MENU_ICON: "menuIcon",
		MENU: "menu",
		PREFERENCE_WIN: "preferenceWin",
		ABOUT_WIN: "aboutWin",
		PLAYLIST_WIN: "playlistWin",
		HISTORY_WIN: "historyWin",
		COMPRESSOR_WIN: "compressorWin",
	},
	LOCAL_STORAGE_KEYS: {
		DOWNLOAD_PATH: "downloadPath",
		YT_DLP_PATH: "ytdlp",
		FFMPEG_PATH: "ffmpegPath",
		MAX_DOWNLOADS: "maxActiveDownloads",
		PREFERRED_VIDEO_QUALITY: "preferredVideoQuality",
		PREFERRED_AUDIO_QUALITY: "preferredAudioQuality",
		PREFERRED_VIDEO_CODEC: "preferredVideoCodec",
		SHOW_MORE_FORMATS: "showMoreFormats",
		BROWSER_COOKIES: "browser",
		PROXY: "proxy",
		CONFIG_PATH: "configPath",
		AUTO_UPDATE: "autoUpdate",
		CLOSE_TO_TRAY: "closeToTray",
		YT_DLP_CUSTOM_ARGS: "customYtDlpArgs",
	},
};

/**
 * Shorthand for document.getElementById.
 * @param {string} id The ID of the DOM element.
 * @returns {HTMLElement | null}
 */
const $ = (id) => document.getElementById(id);

class AurivoDawlodApp {
	constructor() {
		this.state = {
			ytDlp: null,
			ytDlpPath: "",
			ffmpegPath: "",
			jsRuntimePath: "",
			downloadDir: "",
			maxActiveDownloads: 5,
			currentDownloads: 0,
			// Video metadata
			videoInfo: {
				title: "",
				thumbnail: "",
				duration: 0,
				extractor_key: "",
				url: "",
			},
			// Download options
			downloadOptions: {
				rangeCmd: "",
				rangeOption: "",
				subs: "",
				subLangs: "",
			},
			// Preferences
			preferences: {
				videoQuality: 1080,
				audioQuality: "",
				videoCodec: "avc1",
				showMoreFormats: false,
				proxy: "",
				browserForCookies: "",
				customYtDlpArgs: "",
			},
			downloadControllers: new Map(),
			downloadedItems: new Set(),
			downloadQueue: [],
		};
	}

	/**
	 * Initializes the application, setting up directories, finding executables,
	 * and attaching event listeners.
	 */
	async initialize() {
		try {
			// Do not block core UI/event wiring on translation bootstrap.
			this._initializeTranslations().catch((error) => {
				console.warn("Translation bootstrap failed:", error);
			});
			this._setupDirectories();
			this._configureTray();
			this._configureAutoUpdate();
			this._loadSettings();
			this._addEventListeners();
			setTimeout(() => this._ensureCoreUiResponsive(), 2000);
			this._hideStartupSplash();

			this.state.ytDlpPath = await this._withTimeout(
				this._findOrDownloadYtDlp(),
				90000,
				"yt-dlp hazırlanamadı (zaman aşımı)."
			);
			this.state.ytDlp = new YTDlpWrap(`"${this.state.ytDlpPath}"`);
			this.state.ffmpegPath = await this._withTimeout(
				this._findFfmpeg(),
				45000,
				"FFmpeg hazırlanamadı (zaman aşımı)."
			);
			this._showFfmpegInstallHintIfNeeded();
			this.state.jsRuntimePath = await this._getJsRuntimePath();

			console.log("yt-dlp path:", this.state.ytDlpPath);
			console.log("ffmpeg path:", this.state.ffmpegPath);
			console.log("JS runtime path:", this.state.jsRuntimePath);

			// Signal to the main process that the renderer is ready for links
			ipcRenderer.send("ready-for-links");
		} catch (error) {
			console.error("Initialization failed:", error);
			$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent = error.message;
		} finally {
			this._hideStartupSplash();
		}
	}

	_hideStartupSplash() {
		const splashEl = $(CONSTANTS.DOM_IDS.STARTUP_SPLASH);
		if (!splashEl) return;
		splashEl.classList.add("is-hidden");
		setTimeout(() => {
			splashEl.remove();
		}, 500);
	}

	_withTimeout(promise, timeoutMs, timeoutMessage) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(timeoutMessage)),
				timeoutMs
			);
			promise
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	_showFfmpegInstallHintIfNeeded() {
		if (this.state.ffmpegPath) return;
		if (platform() === "linux") {
			const info = getLinuxFfmpegInstallInfo();
			if (info) {
				const msgEl = $(CONSTANTS.DOM_IDS.INCORRECT_MSG);
				msgEl.textContent = `FFmpeg bulunamadi. Kurulum komutu: ${info.primary}`;
				msgEl.style.display = "block";

				const existing = document.getElementById("ffmpegQuickActions");
				if (existing) existing.remove();

				const actions = document.createElement("div");
				actions.id = "ffmpegQuickActions";
				actions.style.marginTop = "8px";
				actions.style.display = "flex";
				actions.style.gap = "8px";
				actions.style.justifyContent = "center";

				const installBtn = document.createElement("button");
				installBtn.className = "blueBtn";
				installBtn.textContent = "FFmpeg Kur";
				installBtn.addEventListener("click", () => this._installFfmpegOnLinux());

				const copyBtn = document.createElement("button");
				copyBtn.className = "submitBtn";
				copyBtn.textContent = "Komutu Kopyala";
				copyBtn.addEventListener("click", () => {
					clipboard.writeText(info.primary);
					this._showPopup(i18n.__("copiedText"), false);
				});

				actions.append(installBtn, copyBtn);

				if (info.family === "arch" && info.alternate) {
					const yayBtn = document.createElement("button");
					yayBtn.className = "blueBtn";
					yayBtn.textContent = "Yay ile Kur";
					yayBtn.addEventListener("click", () => this._installFfmpegOnLinuxYay());
					actions.append(yayBtn);
				}
				msgEl.insertAdjacentElement("afterend", actions);

				if (info.alternate) {
					const alt = document.createElement("div");
					alt.id = "ffmpegAltHint";
					alt.style.marginTop = "6px";
					alt.style.opacity = "0.85";
					alt.style.fontSize = "13px";
					alt.textContent = `Alternatif: ${info.alternate}`;
					actions.insertAdjacentElement("afterend", alt);
				}
			}
			return;
		}
		if (platform() === "freebsd") {
			$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent =
				"FFmpeg bulunamadi. Kurulum: pkg install ffmpeg";
		}
	}

	_ensureCoreUiResponsive() {
		const routeToSecondary = (id, fileName) => {
			const el = $(id);
			if (!el || typeof el.onclick === "function") return;
			el.onclick = () =>
				ipcRenderer.send(
					"load-page",
					join(__dirname, "..", "html", fileName)
				);
		};
		const routeToMain = (id, fileName) => {
			const el = $(id);
			if (!el || typeof el.onclick === "function") return;
			el.onclick = () =>
				ipcRenderer.send(
					"load-win",
					join(__dirname, "..", "html", fileName)
				);
		};

		routeToSecondary(CONSTANTS.DOM_IDS.PREFERENCE_WIN, "preferences.html");
		routeToSecondary(CONSTANTS.DOM_IDS.ABOUT_WIN, "about.html");
		routeToSecondary(CONSTANTS.DOM_IDS.HISTORY_WIN, "history.html");
		routeToMain(CONSTANTS.DOM_IDS.PLAYLIST_WIN, "playlist.html");
		routeToMain(CONSTANTS.DOM_IDS.COMPRESSOR_WIN, "compressor.html");
	}

	async _installFfmpegOnLinux() {
		const res = await ipcRenderer.invoke("install-ffmpeg-linux");
		if (!res?.success) {
			this._showPopup(res?.message || "FFmpeg kurulumu basarisiz.", true);
			return;
		}

		this._showPopup("FFmpeg kuruldu. Kontrol ediliyor...", false);
		this.state.ffmpegPath = await this._findFfmpeg();
		if (this.state.ffmpegPath) {
			$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent = "";
			document.getElementById("ffmpegQuickActions")?.remove();
			document.getElementById("ffmpegAltHint")?.remove();
			this._showPopup("FFmpeg hazir.", false);
		}
	}

	async _installFfmpegOnLinuxYay() {
		const res = await ipcRenderer.invoke("install-ffmpeg-linux-yay");
		if (!res?.success) {
			this._showPopup(res?.message || "FFmpeg yay kurulumu basarisiz.", true);
			return;
		}

		this._showPopup("FFmpeg kuruldu. Kontrol ediliyor...", false);
		this.state.ffmpegPath = await this._findFfmpeg();
		if (this.state.ffmpegPath) {
			$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent = "";
			document.getElementById("ffmpegQuickActions")?.remove();
			document.getElementById("ffmpegAltHint")?.remove();
			this._showPopup("FFmpeg hazir.", false);
		}
	}

	/**
	 * Sets up the application's hidden directory and the default download directory.
	 */
	_setupDirectories() {
		const userHomeDir = homedir();
		const hiddenDir = join(userHomeDir, ".aurivo-dawlod");

		if (!existsSync(hiddenDir)) {
			try {
				mkdirSync(hiddenDir, {recursive: true});
			} catch (error) {
				console.log(error);
			}
		}

		let defaultDownloadDir = join(userHomeDir, "Downloads");
		if (platform() === "linux") {
			try {
				const xdgDownloadDir = execSync("xdg-user-dir DOWNLOAD")
					.toString()
					.trim();
				if (xdgDownloadDir) {
					defaultDownloadDir = xdgDownloadDir;
				}
			} catch (err) {
				console.warn("Could not execute xdg-user-dir:", err.message);
			}
		}

		const savedPath = localStorage.getItem(
			CONSTANTS.LOCAL_STORAGE_KEYS.DOWNLOAD_PATH
		);
		if (savedPath) {
			try {
				accessSync(savedPath, constants.W_OK);
				this.state.downloadDir = savedPath;
			} catch {
				console.warn(
					`Cannot write to saved path "${savedPath}". Falling back to default.`
				);
				this.state.downloadDir = defaultDownloadDir;
				localStorage.setItem(
					CONSTANTS.LOCAL_STORAGE_KEYS.DOWNLOAD_PATH,
					defaultDownloadDir
				);
			}
		} else {
			this.state.downloadDir = defaultDownloadDir;
		}

		$(CONSTANTS.DOM_IDS.PATH_DISPLAY).textContent = this.state.downloadDir;

		if (!existsSync(this.state.downloadDir)) {
			mkdirSync(this.state.downloadDir, {recursive: true});
		}
	}

	/**
	 * Checks localStorage to determine if the tray icon should be used.
	 */
	_configureTray() {
		if (
			localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEYS.CLOSE_TO_TRAY) ===
			"true"
		) {
			console.log("Tray is enabled.");
			ipcRenderer.send("useTray", true);
		}
	}

	/**
	 * Checks settings to determine if auto-updates should be enabled.
	 */
	_configureAutoUpdate() {
		let autoUpdate = true;
		const autoUpdateEnv =
			process.env.AURIVO_AUTO_UPDATES ||
			process.env.YTDOWNLOADER_AUTO_UPDATES;
		if (
			localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEYS.AUTO_UPDATE) ===
			"false"
		) {
			autoUpdate = false;
		}
		if (process.windowsStore || autoUpdateEnv === "0") {
			autoUpdate = false;
		}
		ipcRenderer.send("autoUpdate", autoUpdate);
	}

	/**
	 * Waits for the i18n module to load and then translates the static page content.
	 */
	async _initializeTranslations() {
		return new Promise((resolve) => {
			if (window.__translationsLoaded && window.i18n) {
				window.i18n.translatePage();
				resolve();
				return;
			}

			const fallbackTimer = setTimeout(() => {
				console.warn(
					"translations-loaded event timeout; continuing startup without waiting."
				);
				resolve();
			}, 4000);

			document.addEventListener(
				"translations-loaded",
				() => {
					clearTimeout(fallbackTimer);
					window.i18n.translatePage();
					resolve();
				},
				{once: true}
			);
		});
	}

	/**
	 * Locates the yt-dlp executable path from various sources or downloads it.
	 * @returns {Promise<string>} A promise that resolves with the path to yt-dlp.
	 */
	async _findOrDownloadYtDlp() {
		const hiddenDir = join(homedir(), ".aurivo-dawlod");
		const defaultYtDlpName = platform() === "win32" ? "ytdlp.exe" : "ytdlp";
		const defaultYtDlpPath = join(hiddenDir, defaultYtDlpName);
		const isMacOS = platform() === "darwin";
		const isFreeBSD = platform() === "freebsd";

		let executablePath = null;

		// PRIORITY 1: Environment Variable
		const ytdlpEnvPath =
			process.env.AURIVO_YTDLP_PATH ||
			process.env.YTDOWNLOADER_YTDLP_PATH;
		if (ytdlpEnvPath) {
			if (existsSync(ytdlpEnvPath)) {
				executablePath = ytdlpEnvPath;
			} else {
				throw new Error(
					"AURIVO_YTDLP_PATH/YTDOWNLOADER_YTDLP_PATH is set, but no file exists there."
				);
			}
		}

		// PRIORITY 2: macOS homebrew
		else if (isMacOS) {
			const possiblePaths = [
				"/opt/homebrew/bin/yt-dlp", // Apple Silicon
				"/usr/local/bin/yt-dlp", // Intel
			];

			executablePath = possiblePaths.find((p) => existsSync(p));

			// If Homebrew check fails, show popup and abort
			if (!executablePath) {
				$(CONSTANTS.DOM_IDS.POPUP_BOX_MAC).style.display = "block";
				console.warn("Homebrew yt-dlp not found. Prompting user.");

				return "";
			}
		}

		// PRIORITY 3: FreeBSD
		else if (isFreeBSD) {
			try {
				executablePath = execSync("which yt-dlp").toString().trim();
			} catch {
				throw new Error(
					"No yt-dlp found in PATH on FreeBSD. Please install it."
				);
			}
		}

		// PRIORITY 4: LocalStorage or Download (Windows/Linux)
		else {
			const storedPath = localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.YT_DLP_PATH
			);

			if (storedPath && existsSync(storedPath)) {
				executablePath = storedPath;
			}
			// Download if missing
			else {
				executablePath = await this.ensureYtDlpBinary(defaultYtDlpPath);
			}
		}

		localStorage.setItem(
			CONSTANTS.LOCAL_STORAGE_KEYS.YT_DLP_PATH,
			executablePath
		);

		// Auto update
		this._runBackgroundUpdate(executablePath, isMacOS);

		return executablePath;
	}

	/**
	 * yt-dlp background update
	 */
	_runBackgroundUpdate(executablePath, isMacOS) {
		try {
			if (isMacOS) {
				const brewPaths = [
					"/opt/homebrew/bin/brew",
					"/usr/local/bin/brew",
				];
				const brewExec = brewPaths.find((p) => existsSync(p)) || "brew";

				const brewUpdate = spawn(brewExec, ["upgrade", "yt-dlp"]);

				brewUpdate.on("error", (err) =>
					console.error("Failed to run 'brew upgrade yt-dlp':", err)
				);
				brewUpdate.stdout.on("data", (data) =>
					console.log("yt-dlp brew update:", data.toString())
				);
			} else {
				const updateProc = spawn(executablePath, ["-U"]);

				updateProc.on("error", (err) =>
					console.error(
						"Failed to run background yt-dlp update:",
						err
					)
				);

				updateProc.stdout.on("data", (data) => {
					const output = data.toString();
					console.log("yt-dlp update check:", output);

					if (output.toLowerCase().includes("updating to")) {
						this._showPopup(i18n.__("updatingYtdlp"));
					} else if (
						output.toLowerCase().includes("updated yt-dlp to")
					) {
						this._showPopup(i18n.__("updatedYtdlp"));
					}
				});
			}
		} catch (err) {
			console.warn("Error initiating background update:", err);
		}
	}

	/**
	 * Checks for the presence of the yt-dlp binary at the default path.
	 * If not found, it attempts to download it from GitHub.
	 *
	 * @param {string} defaultYtDlpPath The expected path to the yt-dlp binary.
	 * @returns {Promise<string>} A promise that resolves with the path to the yt-dlp binary.
	 * @throws {Error} Throws an error if the download fails.
	 */
	async ensureYtDlpBinary(defaultYtDlpPath) {
		try {
			await promises.access(defaultYtDlpPath);

			return defaultYtDlpPath;
		} catch {
			console.log("yt-dlp not found, downloading...");

			$(CONSTANTS.DOM_IDS.POPUP_BOX).style.display = "block";
			$(CONSTANTS.DOM_IDS.POPUP_SVG).style.display = "inline";
			document.querySelector("#popupBox p").textContent = i18n.__(
				"downloadingNecessaryFilesWait"
			);

			try {
				await YTDlpWrap.downloadFromGithub(
					defaultYtDlpPath,
					undefined,
					undefined,
					(progress, _d, _t) => {
						$(
							CONSTANTS.DOM_IDS.YTDLP_DOWNLOAD_PROGRESS
						).textContent =
							i18n.__("progress") +
							`: ${(progress * 100).toFixed(2)}%`;
					}
				);

				$(CONSTANTS.DOM_IDS.POPUP_BOX).style.display = "none";

				localStorage.setItem(
					CONSTANTS.LOCAL_STORAGE_KEYS.YT_DLP_PATH,
					defaultYtDlpPath
				);

				return defaultYtDlpPath;
			} catch (downloadError) {
				$(CONSTANTS.DOM_IDS.YTDLP_DOWNLOAD_PROGRESS).textContent = "";

				console.error("Failed to download yt-dlp:", downloadError);

				document.querySelector("#popupBox p").textContent = i18n.__(
					"errorFailedFileDownload"
				);
				$(CONSTANTS.DOM_IDS.POPUP_SVG).style.display = "none";

				const tryAgainBtn = document.createElement("button");
				tryAgainBtn.id = "tryBtn";
				tryAgainBtn.textContent = i18n.__("tryAgain");
				tryAgainBtn.addEventListener("click", () => {
					// TODO: Improve it
					ipcRenderer.send("reload");
				});
				document.getElementById("popup").appendChild(tryAgainBtn);

				throw new Error("Failed to download yt-dlp.");
			}
		}
	}

	/**
	 * Locates the ffmpeg executable path.
	 * @returns {Promise<string>} A promise that resolves with the path to ffmpeg.
	 */
	async _findFfmpeg() {
		const ffmpegPath = await ensureFfmpegPath({
			autoInstallOnWindows: true,
			onStatus: (text) => {
				$(CONSTANTS.DOM_IDS.POPUP_BOX).style.display = "block";
				$(CONSTANTS.DOM_IDS.POPUP_SVG).style.display = "inline";
				document.querySelector("#popupBox p").textContent = text;
			},
			onProgress: (progress) => {
				if (progress > 0) {
					$(CONSTANTS.DOM_IDS.YTDLP_DOWNLOAD_PROGRESS).textContent =
						i18n.__("progress") + `: ${(progress * 100).toFixed(2)}%`;
				} else {
					$(CONSTANTS.DOM_IDS.POPUP_BOX).style.display = "none";
					$(CONSTANTS.DOM_IDS.YTDLP_DOWNLOAD_PROGRESS).textContent = "";
				}
			},
			onError: (error) => {
				console.error("Failed to auto-install ffmpeg:", error);
				this._showPopup("FFmpeg indirilemedi. Lütfen interneti kontrol edin.", true);
			},
		});

		if (!ffmpegPath) {
			console.warn(
				"ffmpeg not found. Video+audio streams cannot be merged until ffmpeg is installed."
			);
		}
		return ffmpegPath;
	}

	/**
	 * Determines the JavaScript runtime path for yt-dlp.
	 * @returns {Promise<string>} A promise that resolves with the JS runtime path.
	 */
	async _getJsRuntimePath() {
		const exeName = "node";

		const nodeEnvPath =
			process.env.AURIVO_NODE_PATH || process.env.YTDOWNLOADER_NODE_PATH;
		if (nodeEnvPath) {
			if (existsSync(nodeEnvPath)) {
				return `$node:"${nodeEnvPath}"`;
			}

			return "";
		}

		const denoEnvPath =
			process.env.AURIVO_DENO_PATH || process.env.YTDOWNLOADER_DENO_PATH;
		if (denoEnvPath) {
			if (existsSync(denoEnvPath)) {
				return `$deno:"${denoEnvPath}"`;
			}

			return "";
		}

		if (platform() === "darwin") {
			const possiblePaths = [
				"/opt/homebrew/bin/deno",
				"/usr/local/bin/deno",
			];

			for (const p of possiblePaths) {
				if (existsSync(p)) {
					return `deno:"${p}"`;
				}
			}

			console.log("No Deno installation found");

			return "";
		}

		let jsRuntimePath = join(__dirname, "..", exeName);

		if (platform() === "win32") {
			jsRuntimePath = join(__dirname, "..", `${exeName}.exe`);
		}

		if (existsSync(jsRuntimePath)) {
			return `${exeName}:"${jsRuntimePath}"`;
		} else {
			return "";
		}
	}

	/**
	 * Loads various settings from localStorage into the application state.
	 */
	_loadSettings() {
		const prefs = this.state.preferences;
		prefs.videoQuality =
			Number(
				localStorage.getItem(
					CONSTANTS.LOCAL_STORAGE_KEYS.PREFERRED_VIDEO_QUALITY
				)
			) || 1080;
		prefs.audioQuality =
			localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.PREFERRED_AUDIO_QUALITY
			) || "";
		prefs.videoCodec =
			localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.PREFERRED_VIDEO_CODEC
			) || "avc1";
		prefs.showMoreFormats =
			localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.SHOW_MORE_FORMATS
			) === "true";
		prefs.proxy =
			localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEYS.PROXY) || "";
		prefs.browserForCookies =
			localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.BROWSER_COOKIES
			) || "";
		prefs.customYtDlpArgs =
			localStorage.getItem(
				CONSTANTS.LOCAL_STORAGE_KEYS.YT_DLP_CUSTOM_ARGS
			) || "";
		prefs.configPath = localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEYS.CONFIG_PATH) || "";

		const maxDownloads = Number(
			localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEYS.MAX_DOWNLOADS)
		);
		this.state.maxActiveDownloads = maxDownloads >= 1 ? maxDownloads : 5;

		// Update UI with loaded settings
		$(CONSTANTS.DOM_IDS.CUSTOM_ARGS_INPUT).value = prefs.customYtDlpArgs;

		const downloadDir = localStorage.getItem(
			CONSTANTS.LOCAL_STORAGE_KEYS.DOWNLOAD_PATH
		);

		if (downloadDir) {
			this.state.downloadDir = downloadDir;
			$(CONSTANTS.DOM_IDS.PATH_DISPLAY).textContent = downloadDir;
		}
	}

	/**
	 * Attaches all necessary event listeners for the UI.
	 */
	_addEventListeners() {
		// Download buttons
		$(CONSTANTS.DOM_IDS.VIDEO_DOWNLOAD_BTN).addEventListener("click", () =>
			this.handleDownloadRequest("video")
		);
		$(CONSTANTS.DOM_IDS.AUDIO_DOWNLOAD_BTN).addEventListener("click", () =>
			this.handleDownloadRequest("audio")
		);
		$(CONSTANTS.DOM_IDS.EXTRACT_BTN).addEventListener("click", () =>
			this.handleDownloadRequest("extract")
		);

		// UI controls
		$(CONSTANTS.DOM_IDS.CLOSE_HIDDEN_BTN).addEventListener("click", () =>
			this._hideInfoPanel()
		);
		$(CONSTANTS.DOM_IDS.SELECT_LOCATION_BTN).addEventListener("click", () =>
			ipcRenderer.send("select-location-main", "")
		);
		$(CONSTANTS.DOM_IDS.CLEAR_BTN).addEventListener("click", () =>
			this._clearAllDownloaded()
		);
		$(CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT).addEventListener("change", () =>
			this._syncAudioSelectionForVideo()
		);

		// Error details
		$(CONSTANTS.DOM_IDS.ERROR_DETAILS).addEventListener("click", (e) => {
			// @ts-ignore
			clipboard.writeText(e.target.innerText);
			this._showPopup(i18n.__("copiedText"), false);
		});

		$(CONSTANTS.DOM_IDS.QUIT_APP_BTN).addEventListener("click", () => {
			ipcRenderer.send("quit", "quit");
		});

		// IPC listeners
		ipcRenderer.on("link", (event, text) => this.getInfo(text));
		ipcRenderer.on("downloadPath", (event, downloadPath) => {
			try {
				accessSync(downloadPath[0], constants.W_OK);

				const newPath = downloadPath[0];
				$(CONSTANTS.DOM_IDS.PATH_DISPLAY).textContent = newPath;
				this.state.downloadDir = newPath;
			} catch (error) {
				console.log(error);
				this._showPopup(i18n.__("unableToAccessDir"), true);
			}
		});

		ipcRenderer.on("download-progress", (_event, percent) => {
			if (percent) {
				const popup = $(CONSTANTS.DOM_IDS.UPDATE_POPUP);
				const textEl = $(CONSTANTS.DOM_IDS.UPDATE_POPUP_PROGRESS);
				const barEl = $(CONSTANTS.DOM_IDS.UPDATE_POPUP_BAR);

				popup.style.display = "flex";
				textEl.textContent = `${percent.toFixed(1)}%`;
				barEl.style.width = `${percent}%`;
			}
		});

		ipcRenderer.on("update-downloaded", (_event, _) => {
			$(CONSTANTS.DOM_IDS.UPDATE_POPUP).style.display = "none";
		});

		// Menu Listeners
		const menuMapping = {
			[CONSTANTS.DOM_IDS.PREFERENCE_WIN]: join(
				__dirname,
				"..",
				"html",
				"preferences.html"
			),
			[CONSTANTS.DOM_IDS.ABOUT_WIN]: join(
				__dirname,
				"..",
				"html",
				"about.html"
			),
			[CONSTANTS.DOM_IDS.HISTORY_WIN]: join(
				__dirname,
				"..",
				"html",
				"history.html"
			),
		};
		const windowMapping = {
			[CONSTANTS.DOM_IDS.PLAYLIST_WIN]: join(
				__dirname,
				"..",
				"html",
				"playlist.html"
			),
			[CONSTANTS.DOM_IDS.COMPRESSOR_WIN]: join(
				__dirname,
				"..",
				"html",
				"compressor.html"
			),
		};

		Object.entries(menuMapping).forEach(([id, page]) => {
			$(id)?.addEventListener("click", () => {
				this._closeMenu();
				ipcRenderer.send("load-page", page);
			});
		});

		Object.entries(windowMapping).forEach(([id, page]) => {
			$(id)?.addEventListener("click", () => {
				this._closeMenu();
				ipcRenderer.send("load-win", page);
			});
		});

		const minSlider = $(CONSTANTS.DOM_IDS.MIN_SLIDER);
		const maxSlider = $(CONSTANTS.DOM_IDS.MAX_SLIDER);

		minSlider.addEventListener("input", () =>
			this._updateSliderUI(minSlider)
		);
		maxSlider.addEventListener("input", () =>
			this._updateSliderUI(maxSlider)
		);

		$(CONSTANTS.DOM_IDS.START_TIME).addEventListener(
			"change",
			this._handleTimeInputChange
		);
		$(CONSTANTS.DOM_IDS.END_TIME).addEventListener(
			"change",
			this._handleTimeInputChange
		);

		this._updateSliderUI(null);
	}

	// --- Public Methods ---

	/**
	 * Fetches video metadata from a given URL.
	 * @param {string} url The video URL.
	 */
	async getInfo(url) {
		this._loadSettings();
		this._defaultVideoToggle();
		this._resetUIForNewLink();
		this.state.videoInfo.url = url;

		try {
			const metadata = await this._fetchVideoMetadata(url);
			console.log(metadata);

			const durationInt =
				metadata.duration == null ? null : Math.ceil(metadata.duration);

			this.state.videoInfo = {
				...this.state.videoInfo,
				id: metadata.id,
				title: metadata.title,
				thumbnail: metadata.thumbnail,
				duration: durationInt,
				extractor_key: metadata.extractor_key,
			};
			this.setVideoLength(durationInt);
			this._populateFormatSelectors(metadata.formats || []);
			this._displayInfoPanel();
		} catch (error) {
			if (
				error.message.includes("js-runtimes") &&
				error.message.includes("no such option")
			) {
				this._showError(i18n.__("ytDlpUpdateRequired"), url);
			} else {
				this._showError(error.message, url);
			}
		} finally {
			$(CONSTANTS.DOM_IDS.LOADING_WRAPPER).style.display = "none";
		}
	}

	/**
	 * Handles a download request, either starting it immediately or queuing it.
	 * @param {'video' | 'audio' | 'extract'} type The type of download.
	 */
	handleDownloadRequest(type) {
		this._updateDownloadOptionsFromUI();
		if (type === "video") {
			this._syncAudioSelectionForVideo();
			const videoParts = $(
				CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT
			).value.split("|");
			const videoAcodec = videoParts[4] || "none";
			const selectedAudioFid = $(
				CONSTANTS.DOM_IDS.AUDIO_FOR_VIDEO_FORMAT_SELECT
			).value.split("|")[0];
			const wantsMergedAudio =
				videoAcodec === "none" && selectedAudioFid !== "none";

			if (wantsMergedAudio && !this.state.ffmpegPath) {
				this._showPopup(
					"FFmpeg bulunamadı. Video+ses birleştirme için FFmpeg kurun.",
					true
				);
				return;
			}
		} else if (type === "audio" || type === "extract") {
			// Embedding cover art into audio containers requires FFmpeg.
			let ext = "";
			if (type === "audio") {
				ext = String($(CONSTANTS.DOM_IDS.AUDIO_FORMAT_SELECT).value.split("|")[1] || "");
			} else {
				ext = String($(CONSTANTS.DOM_IDS.EXTRACT_SELECTION).value || "");
				if (ext === "alac") ext = "m4a";
			}
			const wantsCoverEmbed =
				(type === "audio" && ["m4a", "mp3", "mp4", "opus"].includes(ext)) ||
				(type === "extract" && ["m4a", "mp3"].includes(ext));
			if (wantsCoverEmbed && !this.state.ffmpegPath) {
				this._showPopup(i18n.__("ffmpegRequiredForCover"), true);
				return;
			}
		}

		const downloadJob = {
			type,
			url: this.state.videoInfo.url,
			title: this.state.videoInfo.title,
			thumbnail: this.state.videoInfo.thumbnail,
			options: {...this.state.downloadOptions},
			// Capture UI values at the moment of click
			uiSnapshot: {
				videoFormat: $(CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT).value,
				audioForVideoFormat: $(
					CONSTANTS.DOM_IDS.AUDIO_FOR_VIDEO_FORMAT_SELECT
				).value,
				audioFormat: $(CONSTANTS.DOM_IDS.AUDIO_FORMAT_SELECT).value,
				extractFormat: $(CONSTANTS.DOM_IDS.EXTRACT_SELECTION).value,
				extractQuality: $(CONSTANTS.DOM_IDS.EXTRACT_QUALITY_SELECT)
					.value,
			},
		};

		if (this.state.currentDownloads < this.state.maxActiveDownloads) {
			this._startDownload(downloadJob);
		} else {
			this._queueDownload(downloadJob);
		}
		this._hideInfoPanel();
	}

	/**
	 * Executes yt-dlp to get video metadata in JSON format.
	 * @param {string} url The video URL.
	 * @returns {Promise<object>} A promise that resolves with the parsed JSON metadata.
	 */
	_fetchVideoMetadata(url) {
		return new Promise((resolve, reject) => {
			const {proxy, browserForCookies, configPath} =
				this.state.preferences;
			const args = [
				"-j",
				"--no-playlist",
				"--no-warnings",
				proxy ? "--proxy" : "",
				proxy,
				browserForCookies ? "--cookies-from-browser" : "",
				browserForCookies,
				this.state.jsRuntimePath
					? `--no-js-runtimes --js-runtime ${this.state.jsRuntimePath}`
					: "",
				configPath ? "--config-location" : "",
				configPath ? `"${configPath}"` : "",
				`"${url}"`,
			].filter(Boolean);

			const process = this.state.ytDlp.exec(args, {shell: true});

			console.log(
			"Spawned yt-dlp with args:",
			process.ytDlpProcess.spawnargs.join(" ")
		);

			let stdout = "";
			let stderr = "";

			process.ytDlpProcess.stdout.on("data", (data) => {
				stdout += data;
			});
			process.ytDlpProcess.stderr.on("data", (data) => (stderr += data));

			process.on("close", () => {
				if (stdout) {
					try {
						resolve(JSON.parse(stdout));
					} catch (e) {
						reject(
							new Error(
								"Failed to parse yt-dlp JSON output: " +
									(stderr || e.message)
							)
						);
					}
				} else {
					reject(
						new Error(
							stderr || `yt-dlp exited with a non-zero code.`
						)
					);
				}
			});

			process.on("error", (err) => reject(err));
		});
	}

	/**
	 * Starts the download process for a given job.
	 * @param {object} job The download job object.
	 */
	_startDownload(job) {
		this.state.currentDownloads++;
		const randomId = "item_" + Math.random().toString(36).substring(2, 12);

		const {downloadArgs, finalFilename, finalExt} =
			this._prepareDownloadArgs(job);

		this._createDownloadUI(randomId, job);

		const controller = new AbortController();
		this.state.downloadControllers.set(randomId, controller);

		const downloadProcess = this.state.ytDlp.exec(downloadArgs, {
			shell: true,
			detached: false,
			signal: controller.signal,
		});

		console.log(
			"Spawned yt-dlp with args:",
			downloadProcess.ytDlpProcess.spawnargs.join(" ")
		);

		// Attach event listeners
		downloadProcess
			.on("progress", (progress) => {
				this._updateProgressUI(randomId, progress);
			})
			.once("ytDlpEvent", () => {
				const el = $(`${randomId}_prog`);
				if (el) el.textContent = i18n.__("downloading");
			})
			// .on("ytDlpEvent", (eventType, eventData) => {
			// 	console.log(eventData)
			// })
			.once("close", (code) => {
				this._handleDownloadCompletion(
					code,
					randomId,
					finalFilename,
					finalExt,
					job.thumbnail
				);
			})
			.once("error", (error) => {
				this.state.downloadedItems.add(randomId);
				this._updateClearAllButton();

				this._handleDownloadError(error, randomId);
			});
	}

	/**
	 * Queues a download job if the maximum number of active downloads is reached.
	 * @param {object} job The download job object.
	 */
	_queueDownload(job) {
		const randomId = "queue_" + Math.random().toString(36).substring(2, 12);
		this.state.downloadQueue.push({...job, queueId: randomId});
		const itemHTML = `
            <div class="item" id="${randomId}">
                <div class="itemIconBox">
                    <img src="${
						job.thumbnail || "../assets/images/thumb.png"
					}" alt="thumbnail" class="itemIcon" crossorigin="anonymous">
                    <span class="itemType">${i18n.__(
						job.type === "video" ? "video" : "audio"
					)}</span>
                </div>
                <div class="itemBody">
                    <div class="itemTitle">${job.title}</div>
                    <p>${i18n.__("preparing")}</p>
                </div>
            </div>`;
		$(CONSTANTS.DOM_IDS.DOWNLOAD_LIST).insertAdjacentHTML(
			"beforeend",
			itemHTML
		);
	}

	/**
	 * Checks the queue and starts the next download if a slot is available.
	 */
	_processQueue() {
		if (
			this.state.downloadQueue.length > 0 &&
			this.state.currentDownloads < this.state.maxActiveDownloads
		) {
			const nextJob = this.state.downloadQueue.shift();
			// Remove the pending UI element
			$(nextJob.queueId)?.remove();
			this._startDownload(nextJob);
		}
	}

	/**
	 * Prepares the command-line arguments for yt-dlp based on the download job.
	 * @param {object} job The download job object.
	 * @returns {{downloadArgs: string[], finalFilename: string, finalExt: string}}
	 */
	_prepareDownloadArgs(job) {
		const {type, url, title, options, uiSnapshot} = job;
		const {rangeOption, rangeCmd, subs, subLangs} = options;
		const {proxy, browserForCookies, configPath} = this.state.preferences;

		let format_id, ext, audioForVideoFormat_id, audioFormat;
		let audioNeedsExtract = false;
		let audioExtractFormat = "";
		let audioExtractQuality = "";

		if (type === "video") {
			const [videoFid, videoExt, _, videoCodec] =
				uiSnapshot.videoFormat.split("|");
			const [audioFid, audioExt] =
				uiSnapshot.audioForVideoFormat.split("|");

			format_id = videoFid;
			audioForVideoFormat_id = audioFid;

			const finalAudioExt = audioExt === "webm" ? "opus" : audioExt;

			ext = videoExt;

			if (videoExt === "mp4" && finalAudioExt === "opus") {
				if (videoCodec.includes("avc")) ext = "mkv";
				else if (videoCodec.includes("av01")) ext = "webm";
			} else if (
				videoExt === "webm" &&
				["m4a", "mp4"].includes(finalAudioExt)
			) {
				ext = "mkv";
			}

			audioFormat =
				audioForVideoFormat_id === "none"
					? ""
					: `+${audioForVideoFormat_id}`;
		} else if (type === "audio") {
			[format_id, ext] = uiSnapshot.audioFormat.split("|");
			ext = ext === "webm" ? "opus" : ext;
			// Opus downloads are not supported by the native BASS engine in Aurivo (no bassopus),
			// and cover art embedding is less consistent. Convert to MP3 for compatibility.
			if (ext === "opus") {
				audioNeedsExtract = true;
				audioExtractFormat = "mp3";
				audioExtractQuality = "0"; // best VBR
				ext = "mp3";
			}
		} else {
			// type === 'extract'
			ext =
				{alac: "m4a"}[uiSnapshot.extractFormat] ||
				uiSnapshot.extractFormat;
		}

		const invalidChars =
			platform() === "win32" ? /[<>:"/\\|?*[\]`#]/g : /["/`#]/g;
		let finalFilename = title
			.replace(invalidChars, "")
			.trim()
			.slice(0, 100);
		if (finalFilename.startsWith(".")) {
			finalFilename = finalFilename.substring(1);
		}
		if (rangeCmd) {
			let rangeTxt = rangeCmd.replace("*", "");
			if (platform() === "win32") rangeTxt = rangeTxt.replace(/:/g, "_");
			finalFilename += ` [${rangeTxt}]`;
		}

		const outputPath = `"${join(
			this.state.downloadDir,
			`${finalFilename}.${ext}`
		)}"`;

		const baseArgs = [
			"--no-playlist",
			"--no-mtime",
			browserForCookies ? "--cookies-from-browser" : "",
			browserForCookies,
			proxy ? "--proxy" : "",
			proxy,
			configPath ? "--config-location" : "",
			configPath ? `"${configPath}"` : "",
			this.state.ffmpegPath ? "--ffmpeg-location" : "",
			this.state.ffmpegPath ? `"${this.state.ffmpegPath}"` : "",
			this.state.jsRuntimePath
				? `--no-js-runtimes --js-runtime ${this.state.jsRuntimePath}`
				: "",
		].filter(Boolean);

		const wantsCoverEmbed =
			(type === "audio" && ["m4a", "mp3", "mp4"].includes(ext)) ||
			(type === "extract" && ["m4a", "mp3"].includes(ext));
		if (wantsCoverEmbed) {
			// Thumbnails are often WEBP; convert to JPG for best compatibility in tags.
			baseArgs.unshift("--convert-thumbnails", "jpg");
			baseArgs.unshift("--embed-thumbnail");
			baseArgs.unshift("--add-metadata");
		}

		let downloadArgs;
		if (type === "extract") {
			downloadArgs = [
				"-x",
				"--audio-format",
				uiSnapshot.extractFormat,
				"--audio-quality",
				uiSnapshot.extractQuality,
				"-o",
				outputPath,
				...baseArgs,
			];
		} else if (type === "audio" && audioNeedsExtract) {
			downloadArgs = [
				"-f",
				format_id,
				"-x",
				"--audio-format",
				audioExtractFormat,
				"--audio-quality",
				audioExtractQuality,
				"-o",
				outputPath,
				...baseArgs,
			];
		} else {
			const formatString =
				type === "video" ? `${format_id}${audioFormat}` : format_id;
			downloadArgs = ["-f", formatString, "-o", outputPath, ...baseArgs];
		}

		if (subs) downloadArgs.push(subs);
		if (subLangs) downloadArgs.push(subLangs);
		if (rangeOption) downloadArgs.push(rangeOption, rangeCmd);

		const customArgsString = $(
			CONSTANTS.DOM_IDS.CUSTOM_ARGS_INPUT
		).value.trim();
		if (customArgsString) {
			const customArgs = customArgsString.split(/\s+/);
			downloadArgs.push(...customArgs);
		}

		downloadArgs.push(`"${url}"`);

		return {downloadArgs, finalFilename, finalExt: ext};
	}

	/**
	 * Handles the completion of a download process.
	 */
	_handleDownloadCompletion(code, randomId, filename, ext, thumbnail) {
		this.state.currentDownloads--;
		this.state.downloadControllers.delete(randomId);

		if (code === 0) {
			this._showDownloadSuccessUI(randomId, filename, ext, thumbnail);
			this.state.downloadedItems.add(randomId);
			this._updateClearAllButton();
		} else if (code !== null) {
			// code is null if aborted, so only show error if it's a real exit code
			this._handleDownloadError(
				new Error(`Download process exited with code ${code}.`),
				randomId
			);
		}

		this._processQueue();

		if ($(CONSTANTS.DOM_IDS.QUIT_CHECKED).checked) {
			ipcRenderer.send("quit", "quit");
		}
	}

	/**
	 * Handles an error during the download process.
	 */
	_handleDownloadError(error, randomId) {
		if (
			error.name === "AbortError" ||
			error.message.includes("AbortError")
		) {
			console.log(`Download ${randomId} was aborted.`);
			this.state.currentDownloads = Math.max(
				0,
				this.state.currentDownloads - 1
			);
			this.state.downloadControllers.delete(randomId);
			this._processQueue();
			return; // Don't treat user cancellation as an error
		}
		this.state.currentDownloads--;
		this.state.downloadControllers.delete(randomId);
		console.error("Download Error:", error);
		const progressEl = $(`${randomId}_prog`);
		if (progressEl) {
			progressEl.textContent = i18n.__("errorHoverForDetails");
			progressEl.title = error.message;
		}
		this._processQueue();
	}

	/**
	 * Updates the download options state from the UI elements.
	 */
	_updateDownloadOptionsFromUI() {
		const startTime = $(CONSTANTS.DOM_IDS.START_TIME).value;
		const endTime = $(CONSTANTS.DOM_IDS.END_TIME).value;
		const duration = this.state.videoInfo.duration;

		const startSeconds = this.parseTime(startTime);
		const endSeconds = this.parseTime(endTime);

		if (
			startSeconds === 0 &&
			(endSeconds === duration || endSeconds === 0)
		) {
			this.state.downloadOptions.rangeCmd = "";
			this.state.downloadOptions.rangeOption = "";
		} else {
			const start = startTime || "0";
			const end = endTime || "inf";
			this.state.downloadOptions.rangeCmd = `*${start}-${end}`;
			this.state.downloadOptions.rangeOption = "--download-sections";
		}

		if ($(CONSTANTS.DOM_IDS.SUB_CHECKED).checked) {
			this.state.downloadOptions.subs = "--write-subs";
			this.state.downloadOptions.subLangs = "--sub-langs all";
		} else {
			this.state.downloadOptions.subs = "";
			this.state.downloadOptions.subLangs = "";
		}
	}

	/**
	 * Resets the UI state for a new link.
	 */
	_resetUIForNewLink() {
		this._hideInfoPanel();
		$(CONSTANTS.DOM_IDS.LOADING_WRAPPER).style.display = "flex";
		$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent = "";
		$(CONSTANTS.DOM_IDS.ERROR_BTN).style.display = "none";
		$(CONSTANTS.DOM_IDS.ERROR_DETAILS).style.display = "none";
		$(CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT).innerHTML = "";
		$(CONSTANTS.DOM_IDS.AUDIO_FORMAT_SELECT).innerHTML = "";
		const noAudioTxt = i18n.__("noAudio");
		$(
			CONSTANTS.DOM_IDS.AUDIO_FOR_VIDEO_FORMAT_SELECT
		).innerHTML = `<option value="none|none">${noAudioTxt}</option>`;
	}

	/**
	 * Populates the video and audio format <select> elements.
	 * @param {Array} formats The formats array from yt-dlp metadata.
	 */
	_populateFormatSelectors(formats) {
		const videoSelect = $(CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT);
		const audioSelect = $(CONSTANTS.DOM_IDS.AUDIO_FORMAT_SELECT);
		const audioForVideoSelect = $(
			CONSTANTS.DOM_IDS.AUDIO_FOR_VIDEO_FORMAT_SELECT
		);

		const NBSP = " ";

		const computeDisplaySize = (format) => {
			let sizeInMB = null;
			let isApprox = false;

			if (format.filesize) {
				sizeInMB = format.filesize / 1000000;
			} else if (format.filesize_approx) {
				sizeInMB = format.filesize_approx / 1000000;
				isApprox = true;
			} else if (this.state.videoInfo.duration && format.tbr) {
				sizeInMB = (this.state.videoInfo.duration * format.tbr) / 8192;
				isApprox = true;
			}

			return sizeInMB
				? `${isApprox ? "~" : ""}${sizeInMB.toFixed(2)} MB`
				: i18n.__("unknownSize");
		};

		let maxVideoQualityLen = 0;
		let maxAudioQualityLen = 0;

		formats.forEach((format) => {
			if (format.video_ext !== "none" && format.vcodec !== "none") {
				const quality = `${format.height || "???"}p${
					format.fps === 60 ? "60" : ""
				}`;
				if (quality.length > maxVideoQualityLen) {
					maxVideoQualityLen = quality.length;
				}
			} else if (
				format.acodec !== "none" &&
				format.video_ext === "none"
			) {
				const formatNote =
					i18n.__(format.format_note) || i18n.__("unknownQuality");
				if (formatNote.length > maxAudioQualityLen) {
					maxAudioQualityLen = formatNote.length;
				}
			}
		});

		const videoQualityPadding = maxVideoQualityLen;
		const audioQualityPadding = maxAudioQualityLen;

		const extPadding = 5; // "mp4", "webm"
		const vcodecPadding = 5; // "avc1", "vp9"
		const filesizePadding = 10; // "12.48 MB"

		const {videoQuality, videoCodec, showMoreFormats} =
			this.state.preferences;
		const hasSeparateAudioOptions = formats.some(
			(f) =>
				f.acodec !== "none" &&
				f.video_ext === "none"
		);
		let bestMatchHeight = 0;

		formats.forEach((f) => {
			if (
				f.height &&
				f.height <= videoQuality &&
				f.height > bestMatchHeight &&
				f.video_ext !== "none"
			) {
				bestMatchHeight = f.height;
			}
		});
		if (bestMatchHeight === 0 && formats.length > 0) {
			bestMatchHeight = Math.max(
				...formats.filter((f) => f.height).map((f) => f.height)
			);
		}
		const availableCodecs = new Set(
			formats
				.filter((f) => f.height === bestMatchHeight && f.vcodec)
				.map((f) => f.vcodec.split(".")[0])
		);
		const finalCodec = availableCodecs.has(videoCodec)
			? videoCodec
			: [...availableCodecs].pop();
		let isAVideoSelected = false;
		const audioRowsAll = [];

		formats.forEach((format) => {
			const displaySize = computeDisplaySize(format);

			if (format.video_ext !== "none" && format.vcodec !== "none") {
				if (
					!showMoreFormats &&
					(format.ext === "webm" || format.vcodec?.startsWith("vp"))
				) {
					return;
				}
				let isSelected = false;
				if (
					!isAVideoSelected &&
					format.height === bestMatchHeight &&
					format.vcodec?.startsWith(finalCodec)
				) {
					isSelected = true;
					isAVideoSelected = true;
				}

				const quality = `${format.height || "???"}p${
					format.fps === 60 ? "60" : ""
				}`;
				const hasAudio =
					format.acodec !== "none" || hasSeparateAudioOptions ? " 🔊" : "";

				const col1 = quality.padEnd(videoQualityPadding + 1, NBSP);
				const col2 = format.ext.padEnd(extPadding, NBSP);
				const col4 = displaySize.padEnd(filesizePadding, NBSP);

				let optionText;
				if (showMoreFormats) {
					const vcodec = format.vcodec?.split(".")[0] || "";
					const col3 = vcodec.padEnd(vcodecPadding, NBSP);
					optionText = `${col1} | ${col2} | ${col3} | ${col4}${hasAudio}`;
				} else {
					optionText = `${col1} | ${col2} | ${col4}${hasAudio}`;
				}

				const option = `<option value="${format.format_id}|${
					format.ext
				}|${format.height}|${format.vcodec}|${format.acodec || "none"}" ${
					isSelected ? "selected" : ""
				}>${optionText}</option>`;

				videoSelect.innerHTML += option;
			} else if (
				format.acodec !== "none" &&
				format.video_ext === "none"
			) {
				let audioExt = format.ext === "webm" ? "opus" : format.ext;
				// Keep the classic labels in the dropdown (most users expect m4a instead of aac/mp4).
				if (audioExt === "aac" || audioExt === "mp4") audioExt = "m4a";
				const formatNote =
					i18n.__(format.format_note) || i18n.__("unknownQuality");

				const audioExtPadded = audioExt.padEnd(extPadding, NBSP);

				const audioQualityPadded = formatNote.padEnd(
					audioQualityPadding,
					NBSP
				);
				const audioSizePadded = displaySize.padEnd(
					filesizePadding,
					NBSP
				);

				audioRowsAll.push({
					id: format.format_id,
					ext: audioExt,
					noteRaw: String(format.format_note || ""),
					tbr: Number(format.tbr || 0) || 0,
					filesize: Number(format.filesize || format.filesize_approx || 0) || 0,
					optionText: `${audioQualityPadded} | ${audioExtPadded} | ${audioSizePadded}`,
				});
			}
		});

		// Sort audio formats to match the classic UI expectation (low/medium/high then m4a/opus).
		const noteRank = (note) => {
			const n = String(note || "").toLowerCase();
			if (n.includes("low")) return 0;
			if (n.includes("medium") || n.includes("normal")) return 1;
			if (n.includes("high") || n.includes("good")) return 2;
			if (n.includes("best")) return 3;
			return 99;
		};
		const noteKey = (note) => {
			const n = String(note || "").toLowerCase();
			if (n.includes("low")) return "low";
			if (n.includes("medium") || n.includes("normal")) return "medium";
			if (n.includes("high") || n.includes("good")) return "high";
			if (n.includes("best")) return "best";
			return "other";
		};
		const extRank = (ext) => {
			const e = String(ext || "").toLowerCase();
			if (e === "m4a" || e === "aac") return 0;
			if (e === "opus") return 1;
			if (e === "mp3") return 2;
			return 3;
		};

		const sortAudioRows = (rows) => {
			rows.sort((a, b) => {
				const ar = noteRank(a.noteRaw) - noteRank(b.noteRaw);
				if (ar) return ar;
				const er = extRank(a.ext) - extRank(b.ext);
				if (er) return er;
				const tr = (a.tbr || 0) - (b.tbr || 0);
				if (tr) return tr;
				return (a.filesize || 0) - (b.filesize || 0);
			});
			return rows;
		};

		const audioRowsSortedAll = sortAudioRows([...audioRowsAll]);
		let audioRowsForAudio = audioRowsSortedAll;
		let audioRowsForVideo = audioRowsSortedAll;

		// Classic UI: when "More formats" is OFF, keep the audio lists compact:
		// low/medium for m4a/opus (one entry per note+ext).
		if (!showMoreFormats && audioRowsSortedAll.length) {
			const isClassicExt = (e) => {
				const x = String(e || "").toLowerCase();
				return x === "m4a" || x === "opus";
			};
			const classic = audioRowsSortedAll.filter((r) => {
				const nk = noteKey(r.noteRaw);
				return (nk === "low" || nk === "medium") && isClassicExt(r.ext);
			});

			if (classic.length) {
				// Dedupe by (low/medium) x (m4a/opus) to match the old dropdown.
				const bestByKey = new Map();
				for (const r of classic) {
					const nk = noteKey(r.noteRaw);
					const extKey = String(r.ext || "");
					const k = `${nk}|${extKey}`;
					const prev = bestByKey.get(k);
					if (!prev) {
						bestByKey.set(k, r);
						continue;
					}
					// Prefer smaller filesize; if unknown, prefer lower bitrate.
					const prevSize = Number(prev.filesize || 0) || 0;
					const nextSize = Number(r.filesize || 0) || 0;
					if (prevSize && nextSize) {
						if (nextSize < prevSize) bestByKey.set(k, r);
						continue;
					}
					if ((Number(r.tbr || 0) || 0) < (Number(prev.tbr || 0) || 0)) {
						bestByKey.set(k, r);
					}
				}
				const classicRows = sortAudioRows([...bestByKey.values()]);
				audioRowsForAudio = classicRows;
				audioRowsForVideo = classicRows;
			}
		}

		for (const row of audioRowsForAudio) {
			const option_audio = `<option value="${row.id}|${row.ext}">${row.optionText}</option>`;
			audioSelect.innerHTML += option_audio;
		}

		for (const row of audioRowsForVideo) {
			const option_audio = `<option value="${row.id}|${row.ext}">${row.optionText}</option>`;
			audioForVideoSelect.innerHTML += option_audio;
		}

		if (
			formats.every((f) => f.acodec === "none" || f.acodec === undefined)
		) {
			$(CONSTANTS.DOM_IDS.AUDIO_PRESENT_SECTION).style.display = "none";
		} else {
			$(CONSTANTS.DOM_IDS.AUDIO_PRESENT_SECTION).style.display = "block";
		}
		this._syncAudioSelectionForVideo();
	}

	/**
	 * Auto-selects a real audio stream when a video-only format is chosen.
	 */
	_syncAudioSelectionForVideo() {
		const videoSelect = $(CONSTANTS.DOM_IDS.VIDEO_FORMAT_SELECT);
		const audioForVideoSelect = $(
			CONSTANTS.DOM_IDS.AUDIO_FOR_VIDEO_FORMAT_SELECT
		);
		if (!videoSelect || !audioForVideoSelect || !videoSelect.value) return;

		const parts = videoSelect.value.split("|");
		const videoAcodec = parts[4] || "none";
		const isNoAudioSelected = audioForVideoSelect.value.startsWith("none|");

		if (
			videoAcodec === "none" &&
			isNoAudioSelected &&
			audioForVideoSelect.options.length > 1
		) {
			audioForVideoSelect.selectedIndex = 1;
		}
	}

	/**
	 * Shows the hidden panel with video information.
	 */
	_displayInfoPanel() {
		const info = this.state.videoInfo;
		const titleContainer = $(CONSTANTS.DOM_IDS.TITLE_CONTAINER);

		titleContainer.innerHTML = ""; // Clear previous content
		titleContainer.append(
			Object.assign(document.createElement("b"), {
				textContent: i18n.__("title") + ": ",
			}),
			Object.assign(document.createElement("input"), {
				className: "title",
				id: CONSTANTS.DOM_IDS.TITLE_INPUT,
				type: "text",
				value: `${info.title} [${info.id}]`,
				onchange: (e) => (this.state.videoInfo.title = e.target.value),
			})
		);

		document
			.querySelectorAll(CONSTANTS.DOM_IDS.URL_INPUTS)
			.forEach((el) => {
				el.value = info.url;
			});

		const hiddenPanel = $(CONSTANTS.DOM_IDS.HIDDEN_PANEL);
		hiddenPanel.style.display = "inline-block";
		hiddenPanel.classList.add("scaleUp");
	}

	/**
	 * Creates the initial UI element for a new download.
	 */
	_createDownloadUI(randomId, job) {
		const itemHTML = `
            <div class="item" id="${randomId}">
                <div class="itemIconBox">
                    <img src="${
						job.thumbnail || "../assets/images/thumb.png"
					}" alt="thumbnail" class="itemIcon" crossorigin="anonymous">
                    <span class="itemType">${i18n.__(
						job.type === "video" ? "video" : "audio"
					)}</span>
                </div>
                <img src="../assets/images/close.png" class="itemClose" id="${randomId}_close">
                <div class="itemBody">
                    <div class="itemTitle">${job.title}</div>
                    <strong class="itemSpeed" id="${randomId}_speed"></strong>
                    <div id="${randomId}_prog" class="itemProgress">${i18n.__(
			"preparing"
		)}</div>
                </div>
            </div>`;
		$(CONSTANTS.DOM_IDS.DOWNLOAD_LIST).insertAdjacentHTML(
			"beforeend",
			itemHTML
		);

		$(`${randomId}_close`).addEventListener("click", () =>
			this._cancelDownload(randomId)
		);
	}

	/**
	 * Updates the progress bar and speed for a download item.
	 */
	_updateProgressUI(randomId, progress) {
		const speedEl = $(`${randomId}_speed`);
		const progEl = $(`${randomId}_prog`);
		if (!speedEl || !progEl) return;

		let fillEl = progEl.querySelector(".custom-progress-fill");

		if (!fillEl) {
			progEl.innerHTML = "";

			const bar = document.createElement("div");
			bar.className = "custom-progress";

			fillEl = document.createElement("div");
			fillEl.className = "custom-progress-fill";

			bar.appendChild(fillEl);
			progEl.appendChild(bar);
		}

		if (progress.percent === 100) {
			fillEl.style.width = progress.percent + "%";
			speedEl.textContent = "";
			progEl.textContent = i18n.__("processing");
			ipcRenderer.send("progress", 0);

			return;
		}

		speedEl.textContent = `${i18n.__("speed")}: ${
			progress.currentSpeed || "0 B/s"
		}`;
		fillEl.style.width = progress.percent + "%";

		ipcRenderer.send("progress", progress.percent / 100);
	}

	/**
	 * Updates a download item's UI to show it has completed successfully.
	 */
	_showDownloadSuccessUI(randomId, filename, ext, thumbnail) {
		const progressEl = $(`${randomId}_prog`);
		if (!progressEl) return;

		const fullFilename = `${filename}.${ext}`;
		const fullPath = join(this.state.downloadDir, fullFilename);

		progressEl.innerHTML = ""; // Clear progress bar
		const link = document.createElement("b");
		link.textContent = i18n.__("fileSavedClickToOpen");
		link.style.cursor = "pointer";
		link.onclick = () => {
			ipcRenderer.send("show-file", fullPath);
		};
		progressEl.appendChild(link);
		$(`${randomId}_speed`).textContent = "";

		// Send desktop notification
		new Notification("Aurivo-Dawlod", {
			body: fullFilename,
			icon: thumbnail,
		}).onclick = () => {
			shell.showItemInFolder(fullPath);
		};

		// Add to download history
		promises
			.stat(fullPath)
			.then((stat) => {
				const fileSize = stat.size || 0;
				ipcRenderer
					.invoke("add-to-history", {
						title: this.state.videoInfo.title,
						url: this.state.videoInfo.url,
						filename: filename,
						filePath: fullPath,
						fileSize: fileSize,
						format: ext,
						thumbnail: thumbnail,
						duration: this.state.videoInfo.duration,
					})
					.catch((err) =>
						console.error("Error adding to history:", err)
					);
			})
			.catch((error) => console.error("Error saving to history:", error));
	}

	/**
	 * Shows an error message in the main UI.
	 */
	_showError(errorMessage, url) {
		$(CONSTANTS.DOM_IDS.INCORRECT_MSG).textContent =
			i18n.__("errorNetworkOrUrl");
		$(CONSTANTS.DOM_IDS.ERROR_BTN).style.display = "inline-block";
		const errorDetails = $(CONSTANTS.DOM_IDS.ERROR_DETAILS);
		errorDetails.innerHTML = `<strong>URL: ${url}</strong><br><br>${errorMessage}`;
		errorDetails.title = i18n.__("clickToCopy");
	}

	/**
	 * Hides the info panel with an animation.
	 */
	_hideInfoPanel() {
		const panel = $(CONSTANTS.DOM_IDS.HIDDEN_PANEL);
		if (panel.style.display !== "none") {
			panel.classList.remove("scaleUp");
			panel.classList.add("scale");
			setTimeout(() => {
				panel.style.display = "none";
				panel.classList.remove("scale");
			}, 400);
		}
	}

	/**
	 * Displays a temporary popup message.
	 */
	_showPopup(text, isError = false) {
		let popupContainer = document.getElementById("popupContainer");

		if (!popupContainer) {
			popupContainer = document.createElement("div");
			popupContainer.id = "popupContainer";
			popupContainer.className = "popup-container";
			document.body.appendChild(popupContainer);
		}

		const popup = document.createElement("span");
		popup.textContent = text;
		popup.classList.add("popup-item");

		popup.style.background = isError ? "#ff6b6b" : "#54abde";

		if (isError) {
			popup.classList.add("popup-error");
		}

		popupContainer.appendChild(popup);

		setTimeout(() => {
			popup.style.opacity = "0";
			setTimeout(() => {
				popup.remove();
				if (popupContainer.childElementCount === 0) {
					popupContainer.remove();
				}
			}, 1000);
		}, 2200);
	}

	/**
	 * Hides the main menu.
	 */
	_closeMenu() {
		$(CONSTANTS.DOM_IDS.MENU_ICON).style.transform = "rotate(0deg)";
		$(CONSTANTS.DOM_IDS.MENU).style.opacity = "0";
		setTimeout(
			() => ($(CONSTANTS.DOM_IDS.MENU).style.display = "none"),
			500
		);
	}

	/**
	 * Cancels a download in progress or removes it from the queue.
	 * @param {string} id The ID of the download item.
	 */
	_cancelDownload(id) {
		// If it's an active download
		if (this.state.downloadControllers.has(id)) {
			this.state.downloadControllers.get(id).abort();
		}
		// If it's in the queue
		this.state.downloadQueue = this.state.downloadQueue.filter(
			(job) => job.queueId !== id
		);

		// If it has been downloaded, remove from the set
		this.state.downloadedItems.delete(id);

		this._fadeAndRemoveItem(id);
		this._updateClearAllButton();
	}

	/**
	 * Fades and removes a DOM element.
	 */
	_fadeAndRemoveItem(id) {
		const item = $(id);
		if (item) {
			item.classList.add("scale");
			setTimeout(() => item.remove(), 500);
		}
	}

	/**
	 * Removes all completed download items from the UI.
	 */
	_clearAllDownloaded() {
		this.state.downloadedItems.forEach((id) => this._fadeAndRemoveItem(id));
		this.state.downloadedItems.clear();
		this._updateClearAllButton();
	}

	/**
	 * Shows or hides the "Clear All" button based on the number of completed items.
	 */
	_updateClearAllButton() {
		const btn = $(CONSTANTS.DOM_IDS.CLEAR_BTN);
		btn.style.display =
			this.state.downloadedItems.size > 1 ? "inline-block" : "none";
	}

	/**
	 * Toggles between audio and video tabs
	 */
	_defaultVideoToggle() {
		let defaultWindow = "video";
		if (localStorage.getItem("defaultWindow")) {
			defaultWindow = localStorage.getItem("defaultWindow");
		}
		if (defaultWindow == "video") {
			selectVideo();
		} else {
			selectAudio();
		}
	}

	/**
	 * @param {string} timeString
	 */
	parseTime(timeString) {
		const parts = timeString.split(":").map((p) => parseInt(p.trim(), 10));

		let totalSeconds = 0;

		if (parts.length === 3) {
			// H:MM:SS format
			const [hrs, mins, secs] = parts;
			if (
				isNaN(hrs) ||
				isNaN(mins) ||
				isNaN(secs) ||
				mins < 0 ||
				mins > 59 ||
				secs < 0 ||
				secs > 59
			)
				return NaN;
			totalSeconds = hrs * 3600 + mins * 60 + secs;
		} else if (parts.length === 2) {
			// MM:SS format
			const [mins, secs] = parts;
			if (isNaN(mins) || isNaN(secs) || secs < 0 || secs > 59) return NaN;
			totalSeconds = mins * 60 + secs;
		} else if (parts.length === 1) {
			const [secs] = parts;
			if (isNaN(secs)) return NaN;
			totalSeconds = secs;
		} else {
			return NaN;
		}

		return totalSeconds;
	}

	_formatTime(duration) {
		if (duration === null) {
			return "";
		}

		const hrs = Math.floor(duration / 3600);
		const mins = Math.floor((duration % 3600) / 60);
		const secs = Math.floor(duration % 60);

		const paddedMins = String(mins).padStart(2, "0");
		const paddedSecs = String(secs).padStart(2, "0");

		if (hrs > 0) {
			// H:MM:SS format
			return `${hrs}:${paddedMins}:${paddedSecs}`;
		} else {
			// MM:SS format
			return `${paddedMins}:${paddedSecs}`;
		}
	}

	/**
	 * @param {HTMLElement} movedSlider
	 */
	_updateSliderUI(movedSlider) {
		const minSlider = $(CONSTANTS.DOM_IDS.MIN_SLIDER);
		const maxSlider = $(CONSTANTS.DOM_IDS.MAX_SLIDER);
		const minTimeDisplay = $(CONSTANTS.DOM_IDS.START_TIME);
		const maxTimeDisplay = $(CONSTANTS.DOM_IDS.END_TIME);
		const rangeHighlight = $(CONSTANTS.DOM_IDS.SLIDER_RANGE_HIGHLIGHT);

		let minValue = parseInt(minSlider.value);
		let maxValue = parseInt(maxSlider.value);
		const minSliderVal = parseInt(minSlider.min);
		const maxSliderVal = parseInt(minSlider.max);
		const sliderRange = maxSliderVal - minSliderVal;

		// Prevent sliders from crossing each other
		if (minValue >= maxValue) {
			if (movedSlider && movedSlider.id === "min-slider") {
				// Min must be at least 1 second less than Max
				minValue = Math.max(minSliderVal, maxValue - 1);
				minSlider.value = minValue;
			} else {
				// Max must be at least 1 second more than Min
				maxValue = Math.min(maxSliderVal, minValue + 1);
				maxSlider.value = maxValue;
			}
		}

		minTimeDisplay.value = this._formatTime(minValue);
		maxTimeDisplay.value = this._formatTime(maxValue);

		const minPercent = ((minValue - minSliderVal) / sliderRange) * 100;
		const maxPercent = ((maxValue - minSliderVal) / sliderRange) * 100;

		rangeHighlight.style.left = `${minPercent}%`;
		rangeHighlight.style.width = `${maxPercent - minPercent}%`;
	}

	/**
	 * @param {Event} e
	 */
	_handleTimeInputChange = (e) => {
		const input = e.target;
		let newSeconds = this.parseTime(input.value);
		const minSlider = $("min-slider");
		const maxSlider = $("max-slider");

		if (isNaN(newSeconds)) {
			input.value = this._formatTime(
				input.id === "min-time" ? minSlider.value : maxSlider.value
			);
			return;
		}

		const minSliderVal = parseInt(minSlider.min);
		const maxSliderVal = parseInt(minSlider.max);
		newSeconds = Math.max(minSliderVal, Math.min(maxSliderVal, newSeconds));

		if (input.id === "min-time") {
			if (newSeconds >= parseInt(maxSlider.value)) {
				newSeconds = Math.max(
					minSliderVal,
					parseInt(maxSlider.value) - 1
				);
			}
			minSlider.value = newSeconds;
		} else {
			if (newSeconds <= parseInt(minSlider.value)) {
				newSeconds = Math.min(
					maxSliderVal,
					parseInt(minSlider.value) + 1
				);
			}
			maxSlider.value = newSeconds;
		}

		this._updateSliderUI(null);
	};

	/**
	 * Sets the maximum duration for the video and updates the slider's max range.
	 * @param {number} duration - The total length of the video in seconds (must be an integer >= 1).
	 */
	setVideoLength(duration) {
		const minSlider = $(CONSTANTS.DOM_IDS.MIN_SLIDER);
		const maxSlider = $(CONSTANTS.DOM_IDS.MAX_SLIDER);

		if (typeof duration !== "number" || duration < 1) {
			console.error(
				"Invalid duration provided to setVideoLength. Must be a number greater than 0."
			);

			minSlider.max = 0;
			maxSlider.max = 0;

			minSlider.value = 0;
			maxSlider.value = 0;

			return;
		}

		minSlider.max = duration;
		maxSlider.max = duration;

		const defaultMin = 0;
		const defaultMax = duration;

		minSlider.value = defaultMin;
		maxSlider.value = defaultMax;

		this._updateSliderUI(null);
	}
}

// --- Application Entry Point ---
document.addEventListener("DOMContentLoaded", () => {
	const app = new AurivoDawlodApp();
	app.initialize();
});
