const {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	shell,
	Tray,
	Menu,
	clipboard,
} = require("electron");
const {autoUpdater} = require("electron-updater");
const fs = require("fs").promises;
const {existsSync, readFileSync} = require("fs");
const path = require("path");
const {spawn, execSync} = require("child_process");
const DownloadHistory = require("./src/history");
const {getLinuxFfmpegInstallInfo} = require("./src/ffmpeg-manager");

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
autoUpdater.autoDownload = false;

const USER_DATA_PATH = app.getPath("userData");
const CONFIG_FILE_PATH = path.join(USER_DATA_PATH, "aurivo-dawlod.json");
const TRANSLATIONS_DIR = path.join(__dirname, "translations");

const appState = {
	/** @type {BrowserWindow | null} */
	mainWindow: null,
	/** @type {BrowserWindow | null} */
	secondaryWindow: null,
	/** @type {Tray | null} */
	tray: null,
	isQuitting: false,
	indexPageIsOpen: true,
	trayEnabled: false,
	loadedLanguage: {},
	config: {},
	downloadHistory: new DownloadHistory(),
	autoUpdateEnabled: false,
};

function normalizeLocaleForFile(locale) {
	if (!locale) return null;
	const value = String(locale).trim().toLowerCase();
	if (!value) return null;
	if (value === "en-us") return "en";
	// Allow only locale keys like: en, tr, pt-br
	if (/^[a-z]{2,3}(?:-[a-z]{2,3})?$/.test(value) === false) return null;
	return value;
}

function resolveTranslationFile(localeCandidate) {
	// nosemgrep:javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
	const defaultLangPath = path.join(TRANSLATIONS_DIR, "en.json");
	const normalized = normalizeLocaleForFile(localeCandidate);

	if (!normalized) return {locale: "en", filePath: defaultLangPath};

	// nosemgrep:javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
	const fullLocalePath = path.join(TRANSLATIONS_DIR, `${normalized}.json`);
	if (existsSync(fullLocalePath)) {
		return {locale: normalized, filePath: fullLocalePath};
	}

	const langOnly = normalized.split("-")[0];
	if (langOnly && langOnly !== normalized) {
		// nosemgrep:javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
		const langOnlyPath = path.join(TRANSLATIONS_DIR, `${langOnly}.json`);
		if (existsSync(langOnlyPath)) {
			return {locale: langOnly, filePath: langOnlyPath};
		}
	}

	return {locale: "en", filePath: defaultLangPath};
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (appState.mainWindow) {
			if (appState.mainWindow.isMinimized())
				appState.mainWindow.restore();
			appState.mainWindow.show();
			appState.mainWindow.focus();
		}
	});
}

app.whenReady().then(async () => {
	await initialize();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("before-quit", async () => {
	appState.isQuitting = true;
	try {
		// Save the final config state before exiting.
		await saveConfiguration();
	} catch (error) {
		console.error("Failed to save configuration during quit:", error);
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

/**
 * Initializes the application by loading config, translations,
 * and setting up handlers.
 */
async function initialize() {
	await loadConfiguration();
	await loadTranslations();

	registerIpcHandlers();
	registerAutoUpdaterEvents();

	createWindow();

	if (process.platform === "win32") {
		app.setAppUserModelId(app.name);
	}
}

function createWindow() {
	const bounds = appState.config.bounds || {};

	appState.mainWindow = new BrowserWindow({
		...bounds,
		minWidth: 800,
		minHeight: 600,
		autoHideMenuBar: true,
		show: false,
		icon: path.join(__dirname, "/assets/images/icon.png"),
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				webSecurity: true,
				allowRunningInsecureContent: false,
				spellcheck: false,
			},
	});

	appState.mainWindow.loadFile("html/index.html");

	appState.mainWindow.webContents.on("did-finish-load", () => {
		console.log("Main window: did-finish-load");
	});
	appState.mainWindow.webContents.on(
		"console-message",
		(_event, level, message, line, sourceId) => {
			console.log("Renderer console:", {level, message, line, sourceId});
		}
	);
	appState.mainWindow.webContents.on(
		"did-fail-load",
		(_event, code, desc, url) => {
			console.error("Main window: did-fail-load", {code, desc, url});
		}
	);
	appState.mainWindow.webContents.on("render-process-gone", (_event, details) => {
		console.error("Main window: render-process-gone", details);
	});

	appState.mainWindow.once("ready-to-show", () => {
		if (appState.config.isMaximized) {
			appState.mainWindow.maximize();
		}
		appState.mainWindow.show();
	});

	const saveBounds = () => {
		if (appState.mainWindow && !appState.mainWindow.isMaximized()) {
			appState.config.bounds = appState.mainWindow.getBounds();
		}
	};

	appState.mainWindow.on("resize", saveBounds);
	appState.mainWindow.on("move", saveBounds);

	appState.mainWindow.on("maximize", () => {
		appState.config.isMaximized = true;
	});

	appState.mainWindow.on("unmaximize", () => {
		appState.config.isMaximized = false;
	});

	appState.mainWindow.on("close", (event) => {
		if (!appState.isQuitting && appState.trayEnabled) {
			event.preventDefault();
			appState.mainWindow.hide();
			if (app.dock) app.dock.hide();
		}
	});
}

/**
 * @param {string} file The HTML file to load.
 */
function createSecondaryWindow(file) {
	if (appState.secondaryWindow) {
		appState.secondaryWindow.focus();
		return;
	}

	appState.secondaryWindow = new BrowserWindow({
		parent: appState.mainWindow,
		modal: true,
		show: false,
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
				webSecurity: true,
				allowRunningInsecureContent: false,
			},
		width: 1000,
		height: 800,
	});

	// appState.secondaryWindow.webContents.openDevTools();
	appState.secondaryWindow.loadFile(file);
	appState.secondaryWindow.setMenu(null);
	appState.secondaryWindow.once("ready-to-show", () => {
		appState.secondaryWindow.show();
	});

	appState.secondaryWindow.on("closed", () => {
		appState.secondaryWindow = null;
	});
}

/**
 * Creates the system tray icon
 */
function createTray() {
	if (appState.tray) return;

	let iconPath;
	if (process.platform === "win32") {
		iconPath = path.join(__dirname, "resources/icon.ico");
	} else if (process.platform === "darwin") {
		iconPath = path.join(__dirname, "resources/icons/16x16.png");
	} else {
		iconPath = path.join(__dirname, "resources/icons/256x256.png");
	}

	appState.tray = new Tray(iconPath);

	appState.tray.setToolTip("Aurivo-Dawlod");
	refreshTrayMenu();
	appState.tray.on("click", () => {
		appState.mainWindow?.show();

		if (app.dock) app.dock.show();
	});
}

function refreshTrayMenu() {
	if (!appState.tray) return;

	const contextMenu = Menu.buildFromTemplate([
		{
			label: i18n("openApp"),
			click: () => {
				appState.mainWindow?.show();
				if (app.dock) app.dock.show();
			},
		},
		{
			label: i18n("downloadPlaylistButton"),
			click: () => {
				appState.indexPageIsOpen = false;
				appState.mainWindow?.loadFile("html/playlist.html");
				appState.mainWindow?.show();
				if (app.dock) app.dock.show();
			},
		},
		{
			label: i18n("quit"),
			click: () => {
				app.quit();
			},
		},
	]);

	appState.tray.setContextMenu(contextMenu);
}

function registerIpcHandlers() {
	ipcMain.on("autoUpdate", (_event, status) => {
		appState.autoUpdateEnabled = status;

		if (status) {
			autoUpdater.checkForUpdates();
		}
	});

	ipcMain.on("reload", () => {
		appState.mainWindow?.reload();
		appState.secondaryWindow?.reload();
	});

	ipcMain.on("set-locale", async (_event, locale) => {
		try {
			appState.config.locale = normalizeLocaleForFile(locale) || "en";
			await loadTranslations(appState.config.locale);
			refreshTrayMenu();
			await saveConfiguration();
		} catch (error) {
			console.error("Failed to set locale:", error);
		}
	});

	ipcMain.on("get-version", (event) => {
		event.sender.send("version", app.getVersion());
	});

	ipcMain.on("show-file", async (_event, fullPath) => {
		try {
			await fs.stat(fullPath);
			shell.showItemInFolder(fullPath);
		} catch (error) {}
	});

	ipcMain.handle("show-file", async (_event, fullPath) => {
		try {
			await fs.stat(fullPath);
			shell.showItemInFolder(fullPath);

			return {success: true};
		} catch (error) {
			return {success: false, error: error.message};
		}
	});

	ipcMain.handle("open-folder", async (_event, folderPath) => {
		try {
			await fs.stat(folderPath);
			const result = await shell.openPath(folderPath);
			if (result) {
				return {success: false, error: result};
			} else {
				return {success: true};
			}
		} catch (error) {
			return {success: false, error: error.message};
		}
	});

	ipcMain.on("load-win", (_event, file) => {
		appState.indexPageIsOpen = file.includes("index.html");
		appState.mainWindow?.loadFile(file);
	});

	ipcMain.on("load-page", (_event, file) => {
		appState.indexPageIsOpen = file.includes("index.html");
		if (appState.secondaryWindow) {
			appState.secondaryWindow.close();
		}
		appState.mainWindow?.loadFile(file);
	});

	ipcMain.on("close-secondary", () => {
		if (appState.secondaryWindow) {
			appState.secondaryWindow.close();
		}
		appState.indexPageIsOpen = true;
		appState.mainWindow?.loadFile(path.join(__dirname, "html", "index.html"));
	});

	ipcMain.on("quit", () => {
		app.quit();
	});

	ipcMain.on("select-location-main", async () => {
		if (!appState.mainWindow) return;
		const {canceled, filePaths} = await dialog.showOpenDialog(
			appState.mainWindow,
			{properties: ["openDirectory"]}
		);
		if (!canceled && filePaths.length > 0) {
			appState.mainWindow.webContents.send("downloadPath", filePaths);
		}
	});

	ipcMain.on("select-location-secondary", async () => {
		const targetWindow = appState.secondaryWindow || appState.mainWindow;
		if (!targetWindow) return;
		const {canceled, filePaths} = await dialog.showOpenDialog(
			targetWindow,
			{properties: ["openDirectory"]}
		);
		if (!canceled && filePaths.length > 0) {
			targetWindow.webContents.send(
				"downloadPath",
				filePaths
			);
		}
	});

	ipcMain.on("get-directory", async () => {
		if (!appState.mainWindow) return;
		const {canceled, filePaths} = await dialog.showOpenDialog(
			appState.mainWindow,
			{properties: ["openDirectory"]}
		);
		if (!canceled && filePaths.length > 0) {
			appState.mainWindow.webContents.send("directory-path", filePaths);
		}
	});

	ipcMain.on("select-config", async () => {
		const targetWindow = appState.secondaryWindow || appState.mainWindow;
		if (!targetWindow) return;
		const {canceled, filePaths} = await dialog.showOpenDialog(
			targetWindow,
			{properties: ["openFile"]}
		);
		if (!canceled && filePaths.length > 0) {
			targetWindow.webContents.send("configPath", filePaths);
		}
	});

	ipcMain.on("useTray", (_event, enabled) => {
		appState.trayEnabled = enabled;
		if (enabled) createTray();
		else {
			appState.tray?.destroy();
			appState.tray = null;
		}
	});

	ipcMain.on("progress", (_event, percentage) => {
		if (appState.mainWindow) appState.mainWindow.setProgressBar(percentage);
	});

	ipcMain.on("error_dialog", async (_event, message) => {
		const {response} = await dialog.showMessageBox(appState.mainWindow, {
			type: "error",
			title: "Error",
			message: message,
			buttons: ["Ok", i18n("clickToCopy")],
		});
		if (response === 1) clipboard.writeText(message);
	});

	ipcMain.handle("get-system-locale", async (_event) => {
		return app.getSystemLocale();
	});

	ipcMain.handle("install-ffmpeg-linux", async () => {
		if (process.platform !== "linux") {
			return {success: false, message: "Only available on Linux."};
		}

		const info = getLinuxFfmpegInstallInfo();
		if (!info || !info.autoInstall) {
			return {
				success: false,
				message: "Linux package manager could not be detected.",
				hint: info?.primary || "",
			};
		}

		try {
			execSync("which pkexec", {stdio: "ignore"});
		} catch {
			return {
				success: false,
				message: "pkexec bulunamadi.",
				hint: info.primary,
			};
		}

		return new Promise((resolve) => {
			const installer = spawn(
				"pkexec",
				["sh", "-lc", info.autoInstall],
				{shell: false}
			);

			let stderr = "";
			installer.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			installer.on("close", (code) => {
				if (code === 0) {
					resolve({success: true});
				} else {
					resolve({
						success: false,
						message: stderr.trim() || `Install failed with code ${code}`,
						hint: info.primary,
					});
				}
			});

			installer.on("error", (error) => {
				resolve({
					success: false,
					message: error.message,
					hint: info.primary,
				});
			});
		});
	});

	ipcMain.handle("install-ffmpeg-linux-yay", async () => {
		if (process.platform !== "linux") {
			return {success: false, message: "Only available on Linux."};
		}

		const info = getLinuxFfmpegInstallInfo();
		if (!info || info.family !== "arch") {
			return {
				success: false,
				message: "Yay kurulumu sadece Arch tabanli sistemler icin.",
				hint: info?.primary || "",
			};
		}

		try {
			execSync("which pkexec", {stdio: "ignore"});
		} catch {
			return {
				success: false,
				message: "pkexec bulunamadi.",
				hint: info.primary,
			};
		}

		try {
			execSync("which yay", {stdio: "ignore"});
		} catch {
			return {
				success: false,
				message: "yay bulunamadi. Pacman ile kurmayi deneyin.",
				hint: info.primary,
			};
		}

		return new Promise((resolve) => {
			const installer = spawn(
				"pkexec",
				["sh", "-lc", "yay -S --noconfirm ffmpeg"],
				{shell: false}
			);

			let stderr = "";
			installer.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			installer.on("close", (code) => {
				if (code === 0) {
					resolve({success: true});
				} else {
					resolve({
						success: false,
						message: stderr.trim() || `Install failed with code ${code}`,
						hint: info.primary,
					});
				}
			});

			installer.on("error", (error) => {
				resolve({
					success: false,
					message: error.message,
					hint: info.primary,
				});
			});
		});
	});

	ipcMain.handle("get-translation", (_event, locale) => {
		const {filePath: localeFile} = resolveTranslationFile(locale);
		const {filePath: fallbackFile} = resolveTranslationFile("en");
		const fallbackData = JSON.parse(readFileSync(fallbackFile, "utf8"));

		let localeData = {};
		if (localeFile !== fallbackFile && existsSync(localeFile)) {
			try {
				localeData = JSON.parse(readFileSync(localeFile, "utf8"));
			} catch (e) {
				console.error("Could not parse locale file:", localeFile, e);
			}
		}

		const mergedTranslations = {...fallbackData, ...localeData};

		return mergedTranslations;
	});

	ipcMain.handle("get-download-history", () =>
		appState.downloadHistory.getHistory()
	);
	ipcMain.handle("add-to-history", (_, info) =>
		appState.downloadHistory.addDownload(info)
	);
	ipcMain.handle("get-download-stats", () =>
		appState.downloadHistory.getStats()
	);
	ipcMain.handle("delete-history-item", (_, id) =>
		appState.downloadHistory.removeHistoryItem(id)
	);
	ipcMain.handle("clear-all-history", async () => {
		await appState.downloadHistory.clearHistory();
		return true;
	});
	ipcMain.handle("export-history-json", () =>
		appState.downloadHistory.exportAsJSON()
	);
	ipcMain.handle("export-history-csv", () =>
		appState.downloadHistory.exportAsCSV()
	);
}

function registerAutoUpdaterEvents() {
	autoUpdater.on("update-available", async (info) => {
		const dialogOpts = {
			type: "info",
			buttons: [i18n("update"), i18n("no")],
			title: "Update Available",
			message: i18n("updateAvailablePrompt"),
			detail:
				info.releaseNotes?.toString().replace(/<[^>]*>?/gm, "") ||
				"No details available.",
		};
		const {response} = await dialog.showMessageBox(
			appState.mainWindow,
			dialogOpts
		);
		if (response === 0) {
			autoUpdater.downloadUpdate();
		}
	});

	autoUpdater.on("update-downloaded", async () => {
		appState.mainWindow.webContents.send("update-downloaded", "");
		const dialogOpts = {
			type: "info",
			buttons: [i18n("restart"), i18n("later")],
			title: "Update Ready",
			message: i18n("installAndRestartPrompt"),
		};
		const {response} = await dialog.showMessageBox(
			appState.mainWindow,
			dialogOpts
		);
		if (response === 0) {
			autoUpdater.quitAndInstall();
		}
	});

	autoUpdater.on("download-progress", async (info) => {
		appState.mainWindow.webContents.send("download-progress", info.percent);
	});

	autoUpdater.on("error", (error) => {
		console.error("Auto-update error:", error);
		dialog.showErrorBox("Update Error", i18n("updateError"));
	});
}

/**
 * @param {string} phrase The key to translate.
 * @returns {string} The translated string or the key itself.
 */
function i18n(phrase) {
	return appState.loadedLanguage[phrase] || phrase;
}

/**
 * Loads the configuration from the config file.
 */
async function loadConfiguration() {
	try {
		const fileContent = await fs.readFile(CONFIG_FILE_PATH, "utf8");
		appState.config = JSON.parse(fileContent);
	} catch (error) {
		console.log(
			"Could not load config file, using defaults.",
			error.message
		);
		appState.config = {
			bounds: {width: 1024, height: 768},
			isMaximized: false,
		};
	}
}

async function saveConfiguration() {
	try {
		await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(appState.config));
	} catch (error) {
		console.error("Failed to save configuration:", error);
	}
}

async function loadTranslations(localeOverride) {
	const preferredLocale =
		normalizeLocaleForFile(localeOverride) ||
		normalizeLocaleForFile(appState.config.locale) ||
		normalizeLocaleForFile(app.getSystemLocale()) ||
		"en";
	const {locale, filePath} = resolveTranslationFile(preferredLocale);
	appState.config.locale = locale;
	console.log({locale});

	try {
		const fileContent = await fs.readFile(filePath, "utf8");
		appState.loadedLanguage = JSON.parse(fileContent);
	} catch (error) {
		console.error("Failed to load translation file:", error);
		appState.loadedLanguage = {};
	}
}
