(function attachAurivoSettingsShared() {
    const WEB_STARTUP_LAZY_DELAY_OPTIONS = [0, 800, 1400, 2000];
    const WEB_STARTUP_LAZY_DELAY_DEFAULT_MS = 1400;

    function normalizeWebStartupLazyDelayMs(value) {
        const num = Number(value);
        return WEB_STARTUP_LAZY_DELAY_OPTIONS.includes(num) ? num : WEB_STARTUP_LAZY_DELAY_DEFAULT_MS;
    }

    function getPulseQuickPreset(mode) {
        const key = String(mode || '').trim().toLowerCase();
        // Hızlı / Dengeli / Hassas profilleri.
        if (key === 'normal') return { requestInterval: 5, bufferSize: 12 };
        if (key === 'max') return { requestInterval: 3, bufferSize: 16 };
        return { requestInterval: 4, bufferSize: 14 };
    }

    function normalizeVisualMode(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['full', 'balanced', 'minimal'].includes(normalized)) return normalized;
        return 'full';
    }

    function normalizeMotionProfile(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['fast', 'balanced', 'calm'].includes(normalized)) return normalized;
        return 'balanced';
    }

    function normalizeWebMotionPreset(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['calm', 'balanced', 'lively'].includes(normalized)) return normalized;
        return 'balanced';
    }

    function normalizeSfxIconSize(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['compact', 'medium', 'large'].includes(normalized)) return normalized;
        return 'medium';
    }

    const PLAYBACK_SHORTCUT_CODES = new Set([
        'none',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
        'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        'MediaPlayPause', 'MediaPreviousTrack', 'MediaNextTrack',
        'MediaTrackPrevious', 'MediaTrackNext'
    ]);
    const NAVIGATION_SHORTCUT_FIELD_MAP = {
        tabMusic: 'shortcutTabMusic',
        tabVideo: 'shortcutTabVideo',
        tabWeb: 'shortcutTabWeb',
        platformYtmusic: 'shortcutPlatformYtmusic',
        platformYoutube: 'shortcutPlatformYoutube',
        platformDeezer: 'shortcutPlatformDeezer',
        platformSoundcloud: 'shortcutPlatformSoundcloud',
        platformFacebook: 'shortcutPlatformFacebook',
        platformInstagram: 'shortcutPlatformInstagram',
        platformTiktok: 'shortcutPlatformTiktok',
        platformX: 'shortcutPlatformX',
        platformReddit: 'shortcutPlatformReddit',
        platformTwitch: 'shortcutPlatformTwitch',
        platformWhatsapp: 'shortcutPlatformWhatsapp',
        platformTelegram: 'shortcutPlatformTelegram'
    };
    const GALLERY_SHORTCUT_FIELD_MAP = {
        prev: 'shortcutGalleryPrev',
        next: 'shortcutGalleryNext',
        first: 'shortcutGalleryFirst',
        last: 'shortcutGalleryLast',
        pageUp: 'shortcutGalleryPageUp',
        pageDown: 'shortcutGalleryPageDown',
        fit: 'shortcutGalleryFit',
        actual: 'shortcutGalleryActual',
        zoomIn: 'shortcutGalleryZoomIn',
        zoomOut: 'shortcutGalleryZoomOut',
        flipH: 'shortcutGalleryFlipH',
        flipV: 'shortcutGalleryFlipV',
        fullscreenWindow: 'shortcutGalleryFullscreenWindow',
        fullscreenLightbox: 'shortcutGalleryFullscreenLightbox'
    };
    const GALLERY_SHORTCUT_DEFAULTS = {
        prev: 'ArrowLeft',
        next: 'ArrowRight',
        first: 'Home',
        last: 'End',
        pageUp: 'PageUp',
        pageDown: 'PageDown',
        fit: 'W',
        actual: '1',
        zoomIn: '=',
        zoomOut: '-',
        flipH: 'H',
        flipV: 'V',
        fullscreenWindow: 'F',
        fullscreenLightbox: 'Shift+F'
    };

    function normalizePlaybackShortcutCode(value, fallback) {
        const normalized = String(value || '').trim();
        if (!PLAYBACK_SHORTCUT_CODES.has(normalized)) return fallback;
        if (normalized === 'MediaTrackPrevious') return 'MediaPreviousTrack';
        if (normalized === 'MediaTrackNext') return 'MediaNextTrack';
        return normalized;
    }

    function normalizeNavigationShortcut(value) {
        return String(value || '').trim();
    }

    function isShortcutInputEmpty(value) {
        const normalized = normalizeNavigationShortcut(value);
        return !normalized || normalized === '-';
    }

    function applyDefaultGalleryShortcutsToUi({ force = false } = {}) {
        Object.entries(GALLERY_SHORTCUT_FIELD_MAP).forEach(([key, fieldId]) => {
            const input = document.getElementById(fieldId);
            if (!input) return;
            if (!force && !isShortcutInputEmpty(input.value)) return;
            input.value = normalizeNavigationShortcut(GALLERY_SHORTCUT_DEFAULTS[key]);
        });
    }

    function updateGalleryShortcutAssignmentsUi({ autofillDefaults = true } = {}) {
        const galleryHotkeysEnabled = document.getElementById('galleryHotkeysEnabled');
        const assignmentsWrap = document.getElementById('galleryShortcutAssignments');
        if (!galleryHotkeysEnabled) return;
        const enabled = galleryHotkeysEnabled.checked === true;
        if (assignmentsWrap) {
            assignmentsWrap.classList.toggle('hidden', !enabled);
        }
        if (!enabled || !autofillDefaults) return;
        const hasAnyAssigned = Object.values(GALLERY_SHORTCUT_FIELD_MAP).some((fieldId) => {
            const input = document.getElementById(fieldId);
            return input && !isShortcutInputEmpty(input.value);
        });
        if (!hasAnyAssigned) {
            applyDefaultGalleryShortcutsToUi();
        }
    }

    function visualModePreset(mode) {
        const normalized = normalizeVisualMode(mode);
        if (normalized === 'balanced') {
            return { visualMode: 'balanced', uiFxEnabled: true, reduceMotion: true };
        }
        if (normalized === 'minimal') {
            return { visualMode: 'minimal', uiFxEnabled: false, reduceMotion: true };
        }
        return { visualMode: 'full', uiFxEnabled: true, reduceMotion: false };
    }

    function getButtonToggleState(element) {
        if (!element) return false;
        if (element.tagName === 'BUTTON') {
            return element.dataset.active === 'true' || element.getAttribute('aria-pressed') === 'true';
        }
        return !!element.checked;
    }

    function setButtonToggleState(element, active) {
        if (!element) return;
        if (element.tagName === 'BUTTON') {
            element.dataset.active = active ? 'true' : 'false';
            element.setAttribute('aria-pressed', active ? 'true' : 'false');
            element.classList.toggle('active', !!active);
            return;
        }
        element.checked = !!active;
    }

    function switchSettingsTab({ tab, elements, updateSecurityUI, updateAdblockModeUI, refreshAdblockStats }) {
        if (!tab || !elements?.settingsTabs || !elements?.settingsPages) return;
        const tabName = tab.dataset.tab;

        elements.settingsTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        elements.settingsPages.forEach((p) => {
            p.classList.add('hidden');
            p.classList.remove('active');
        });

        const targetPage = document.getElementById(`${tabName}Settings`);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('active');
        }

        if (tabName === 'security') {
            updateSecurityUI?.();
        }

        if (tabName === 'adblock') {
            updateAdblockModeUI?.();
            refreshAdblockStats?.(false);
        }
    }

    function updatePulseQuickModeUi({ elements, mode, defaultMode, getLabel, getDetail }) {
        if (!elements?.pulseQuickMode) return;
        const normalizedMode = String(mode || defaultMode || 'background').trim().toLowerCase();
        const label = getLabel(normalizedMode);
        const detail = getDetail(normalizedMode);
        elements.pulseQuickMode.title = `${label} - ${detail}`;

        if (elements.pulseQuickModeCards?.length) {
            elements.pulseQuickModeCards.forEach((card) => {
                const cardMode = String(card.dataset.pulseQuickMode || '').trim().toLowerCase();
                const active = cardMode === normalizedMode;
                card.classList.toggle('active', active);
                card.setAttribute('aria-checked', active ? 'true' : 'false');
            });
        }

        if (elements.pulseQuickModeDetails) {
            elements.pulseQuickModeDetails.textContent = detail;
        }
    }

    function loadSettingsToUI({
        state,
        elements,
        specialPaths,
        ensureAdblockSettings,
        normalizePulsePreferenceState,
        getPulseQuickModeConfig,
        updatePulseQuickModeUi,
        updateAdblockModeUI,
        updateAdblockBadge,
        blockedCount,
        noSignalDefaultSec,
        translate
    }) {
        if (!state?.settings) return;

        const pb = state.settings.playback || {};
        ensureAdblockSettings?.();

        const crossfadeStop = document.getElementById('crossfadeStop');
        const crossfadeManual = document.getElementById('crossfadeManual');
        const crossfadeAuto = document.getElementById('crossfadeAuto');
        const sameAlbumNoCrossfade = document.getElementById('sameAlbumNoCrossfade');
        const crossfadeMs = document.getElementById('crossfadeMs');
        const fadeOnPause = document.getElementById('fadeOnPause');
        const pauseFadeMs = document.getElementById('pauseFadeMs');
        const crossfadeSkipShortTracks = document.getElementById('crossfadeSkipShortTracks');
        const crossfadeSafetyPaddingMs = document.getElementById('crossfadeSafetyPaddingMs');
        const seekStepSeconds = document.getElementById('seekStepSeconds');
        const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
        const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
        const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
        const endWarningEnabled = document.getElementById('endWarningEnabled');
        const endWarningSeconds = document.getElementById('endWarningSeconds');
        const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
        const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
        const mediaKeyAutoDetect = document.getElementById('mediaKeyAutoDetect');
        const browserNavigationHotkeysEnabled = document.getElementById('browserNavigationHotkeysEnabled');
        const galleryHotkeysEnabled = document.getElementById('galleryHotkeysEnabled');
        const shortcutPrevious = document.getElementById('shortcutPrevious');
        const shortcutPlayPause = document.getElementById('shortcutPlayPause');
        const shortcutNext = document.getElementById('shortcutNext');

        if (crossfadeStop) crossfadeStop.checked = !!pb.crossfadeStopEnabled;
        if (crossfadeManual) crossfadeManual.checked = !!pb.crossfadeManualEnabled;
        if (crossfadeAuto) crossfadeAuto.checked = !!pb.crossfadeAutoEnabled;
        if (sameAlbumNoCrossfade) {
            sameAlbumNoCrossfade.checked = !!pb.sameAlbumNoCrossfade;
            sameAlbumNoCrossfade.disabled = !pb.crossfadeAutoEnabled;
        }
        if (crossfadeMs) crossfadeMs.value = String(Math.max(0, Math.min(15000, Number(pb.crossfadeMs) || 2000)));
        if (fadeOnPause) fadeOnPause.checked = !!pb.fadeOnPauseResume;
        if (pauseFadeMs) pauseFadeMs.value = String(Math.max(0, Math.min(5000, Number(pb.pauseFadeMs) || 250)));
        if (crossfadeSkipShortTracks) crossfadeSkipShortTracks.checked = pb.crossfadeSkipShortTracks !== false;
        if (crossfadeSafetyPaddingMs) crossfadeSafetyPaddingMs.value = String(Math.max(0, Math.min(5000, Number(pb.crossfadeSafetyPaddingMs) || 300)));
        if (seekStepSeconds) seekStepSeconds.value = String(Math.max(1, Math.min(60, Number(pb.seekStepSeconds) || 10)));
        if (restoreLastTrackOnStartup) restoreLastTrackOnStartup.checked = pb.restoreLastTrackOnStartup !== false;
        if (autoplayLastTrackOnStartup) autoplayLastTrackOnStartup.checked = !!pb.autoplayLastTrackOnStartup;
        if (resumePositionOnStartup) resumePositionOnStartup.checked = pb.resumePositionOnStartup !== false;
        if (endWarningEnabled) endWarningEnabled.checked = !!pb.endWarningEnabled;
        if (endWarningSeconds) endWarningSeconds.value = String(Math.max(3, Math.min(60, Number(pb.endWarningSeconds) || 10)));
        if (smartVolumeLevelingEnabled) smartVolumeLevelingEnabled.checked = !!pb.smartVolumeLevelingEnabled;
        if (smartVolumeLevelingMode) {
            const mode = String(pb.smartVolumeLevelingMode || 'balanced').toLowerCase();
            smartVolumeLevelingMode.value = ['gentle', 'balanced', 'strong'].includes(mode) ? mode : 'balanced';
        }
        if (mediaKeyAutoDetect) mediaKeyAutoDetect.checked = pb.mediaKeyAutoDetect !== false;
        if (browserNavigationHotkeysEnabled) browserNavigationHotkeysEnabled.checked = pb.browserNavigationHotkeysEnabled !== false;
        if (galleryHotkeysEnabled) galleryHotkeysEnabled.checked = pb.galleryHotkeysEnabled === true;
        if (shortcutPrevious) shortcutPrevious.value = normalizePlaybackShortcutCode(pb?.customHotkeys?.previous, 'none');
        if (shortcutPlayPause) shortcutPlayPause.value = normalizePlaybackShortcutCode(pb?.customHotkeys?.playPause, 'none');
        if (shortcutNext) shortcutNext.value = normalizePlaybackShortcutCode(pb?.customHotkeys?.next, 'none');
        const navigationShortcuts = (pb?.navigationShortcuts && typeof pb.navigationShortcuts === 'object')
            ? pb.navigationShortcuts
            : {};
        Object.entries(NAVIGATION_SHORTCUT_FIELD_MAP).forEach(([key, fieldId]) => {
            const input = document.getElementById(fieldId);
            if (!input) return;
            input.value = normalizeNavigationShortcut(navigationShortcuts[key]);
        });
        const galleryShortcuts = (pb?.galleryShortcuts && typeof pb.galleryShortcuts === 'object')
            ? pb.galleryShortcuts
            : {};
        Object.entries(GALLERY_SHORTCUT_FIELD_MAP).forEach(([key, fieldId]) => {
            const input = document.getElementById(fieldId);
            if (!input) return;
            input.value = normalizeNavigationShortcut(galleryShortcuts[key]);
        });
        updateGalleryShortcutAssignmentsUi({ autofillDefaults: true });

        if (elements.pulseNoSignalHintSec) {
            const sec = Number(state.settings?.pulseQuick?.noSignalHintSec);
            elements.pulseNoSignalHintSec.value = String([4, 6, 8].includes(sec) ? sec : noSignalDefaultSec);
        }

        if (elements.pulseQuickMode) {
            elements.pulseQuickMode.value = getPulseQuickModeConfig().mode;
            updatePulseQuickModeUi?.();
        }

        const pulsePrefs = normalizePulsePreferenceState(state.settings?.pulsePreferences);
        state.settings.pulsePreferences = pulsePrefs;
        if (elements.pulseEnableNotifications) elements.pulseEnableNotifications.checked = !!pulsePrefs.enable_notifications;
        if (elements.pulseEnableMpris) elements.pulseEnableMpris.checked = !!pulsePrefs.enable_mpris;
        if (elements.pulseEnableSystray) elements.pulseEnableSystray.checked = !!pulsePrefs.enable_systray;
        if (elements.pulseNoDuplicates) elements.pulseNoDuplicates.checked = !!pulsePrefs.no_duplicates;
        if (elements.pulseRequestInterval) elements.pulseRequestInterval.value = String(pulsePrefs.request_interval_secs_v3);
        if (elements.pulseBufferSize) elements.pulseBufferSize.value = String(pulsePrefs.buffer_size_secs);
        if (elements.pulseRecognitionEngine) elements.pulseRecognitionEngine.value = String(pulsePrefs.recognition_engine || 'songrec_only');
        if (elements.pulseAcoustidApiKey) elements.pulseAcoustidApiKey.value = String(pulsePrefs.acoustid_api_key || '');

        if (elements.libraryRememberSection) {
            elements.libraryRememberSection.checked = state.settings?.ui?.rememberLastSection !== false;
        }
        if (elements.behaviorRememberLastSection) {
            elements.behaviorRememberLastSection.checked = state.settings?.ui?.rememberLastSection !== false;
        }
        if (elements.behaviorWebExperienceEnabled) {
            elements.behaviorWebExperienceEnabled.checked = state.settings?.ui?.webExperienceEnabled === true;
        }
        if (elements.libraryRestoreLastFolder) {
            elements.libraryRestoreLastFolder.checked = state.settings?.library?.restoreLastFolder !== false;
        }
        if (elements.libraryRestoreLastPlaylist) {
            elements.libraryRestoreLastPlaylist.checked = state.settings?.library?.restoreLastPlaylist !== false;
        }
        if (elements.libraryRememberTreeSelection) {
            elements.libraryRememberTreeSelection.checked = state.settings?.library?.rememberTreeSelection !== false;
        }
        if (elements.libraryStartupPage) {
            elements.libraryStartupPage.value = String(state.settings?.ui?.startupPage || 'music').toLowerCase();
        }
        if (elements.behaviorStartupPage) {
            elements.behaviorStartupPage.value = String(state.settings?.ui?.startupPage || 'music').toLowerCase();
        }
        const webStartupDelayValue = String(normalizeWebStartupLazyDelayMs(state.settings?.ui?.webStartupLazyDelayMs));
        if (elements.libraryWebStartupDelay) {
            elements.libraryWebStartupDelay.value = webStartupDelayValue;
        }
        if (elements.behaviorWebStartupDelay) {
            elements.behaviorWebStartupDelay.value = webStartupDelayValue;
        }
        if (elements.behaviorWebAnimationMode) {
            const webAnimMode = String(state.settings?.webUi?.animationMode || 'compact').toLowerCase();
            elements.behaviorWebAnimationMode.value = (webAnimMode === 'dock') ? 'dock' : 'compact';
        }
        if (elements.behaviorWebMotionPreset) {
            elements.behaviorWebMotionPreset.value = normalizeWebMotionPreset(state.settings?.webUi?.motionPreset || 'balanced');
        }
        if (elements.behaviorWebLowPowerMode) {
            elements.behaviorWebLowPowerMode.checked = !!state.settings?.webUi?.lowPowerMode;
        }
        if (elements.behaviorCloseToTray) {
            elements.behaviorCloseToTray.checked = state.settings?.ui?.closeToTray !== false;
        }
        if (elements.behaviorNotificationsEnabled) {
            elements.behaviorNotificationsEnabled.checked = state.settings?.ui?.notificationsEnabled === true;
        }
        if (elements.libraryScanOnStartup) {
            elements.libraryScanOnStartup.checked = state.settings?.library?.scanOnStartup !== false;
        }
        if (elements.libraryAutoRescanOnFolderChange) {
            elements.libraryAutoRescanOnFolderChange.checked = state.settings?.library?.autoRescanOnFolderChange !== false;
        }
        if (elements.libraryWatchFolders) {
            elements.libraryWatchFolders.checked = state.settings?.library?.watchFolders !== false;
        }
        if (elements.libraryPreferEmbeddedCover) {
            elements.libraryPreferEmbeddedCover.checked = state.settings?.library?.preferEmbeddedCover !== false;
        }
        if (elements.libraryScanFolderCover) {
            elements.libraryScanFolderCover.checked = state.settings?.library?.scanFolderCover !== false;
        }
        if (elements.libraryMarkMissingCovers) {
            elements.libraryMarkMissingCovers.checked = state.settings?.library?.markMissingCovers !== false;
        }
        if (elements.libraryViewSort) {
            elements.libraryViewSort.value = String(state.settings?.library?.viewSort || 'title').toLowerCase();
        }
        if (elements.libraryViewGroup) {
            elements.libraryViewGroup.value = String(state.settings?.library?.viewGroup || 'none').toLowerCase();
        }
        if (elements.libraryViewMode) {
            elements.libraryViewMode.value = String(state.settings?.library?.viewMode || 'list').toLowerCase();
        }
        if (elements.libraryAudioExtensions) {
            elements.libraryAudioExtensions.value = Array.isArray(state.settings?.library?.audioExtensions)
                ? state.settings.library.audioExtensions.join(', ')
                : '';
        }
        if (elements.libraryVideoExtensions) {
            elements.libraryVideoExtensions.value = Array.isArray(state.settings?.library?.videoExtensions)
                ? state.settings.library.videoExtensions.join(', ')
                : '';
        }
        if (elements.libraryFlowFavoritesEnabled) {
            elements.libraryFlowFavoritesEnabled.checked = state.settings?.library?.smartFlows?.favoritesEnabled !== false;
        }
        if (elements.libraryFlowRecentEnabled) {
            elements.libraryFlowRecentEnabled.checked = state.settings?.library?.smartFlows?.recentEnabled !== false;
        }
        if (elements.libraryFlowMostPlayedEnabled) {
            elements.libraryFlowMostPlayedEnabled.checked = state.settings?.library?.smartFlows?.mostPlayedEnabled !== false;
        }
        if (elements.libraryFlowRecentLimit) {
            elements.libraryFlowRecentLimit.value = String(state.settings?.library?.smartFlows?.recentLimit || 25);
        }
        if (elements.libraryFlowMostPlayedLimit) {
            elements.libraryFlowMostPlayedLimit.value = String(state.settings?.library?.smartFlows?.mostPlayedLimit || 25);
        }
        if (elements.libraryFastScan) {
            elements.libraryFastScan.checked = state.settings?.library?.performance?.fastScan !== false;
        }
        if (elements.libraryLightweightMode) {
            elements.libraryLightweightMode.checked = !!state.settings?.library?.performance?.lightweightMode;
        }
        if (elements.libraryScanSubfolders) {
            elements.libraryScanSubfolders.checked = state.settings?.library?.performance?.scanSubfolders !== false;
        }
        if (elements.libraryGalleryPageJump) {
            const jump = Number(state.settings?.library?.performance?.galleryPageJump);
            elements.libraryGalleryPageJump.value = String(
                Number.isFinite(jump) ? Math.max(1, Math.min(30, Math.round(jump))) : 6
            );
        }
        if (elements.gallerySlideshowIntervalMs) {
            const ms = Number(state.settings?.library?.performance?.gallerySlideshowIntervalMs);
            elements.gallerySlideshowIntervalMs.value = String(
                Number.isFinite(ms) ? Math.max(1000, Math.min(15000, Math.round(ms))) : 3000
            );
        }
        if (elements.gallerySlideshowFastThresholdMs) {
            const value = Number(state.settings?.library?.performance?.galleryFastThresholdMs);
            elements.gallerySlideshowFastThresholdMs.value = String(
                Number.isFinite(value) ? Math.max(1000, Math.min(14000, Math.round(value))) : 2500
            );
        }
        if (elements.gallerySlideshowSlowThresholdMs) {
            const value = Number(state.settings?.library?.performance?.gallerySlowThresholdMs);
            elements.gallerySlideshowSlowThresholdMs.value = String(
                Number.isFinite(value) ? Math.max(1500, Math.min(15000, Math.round(value))) : 5000
            );
        }
        if (elements.galleryTransitionSlideshowMs) {
            const value = Number(state.settings?.library?.performance?.galleryTransitionSlideshowMs);
            elements.galleryTransitionSlideshowMs.value = String(
                Number.isFinite(value) ? Math.max(280, Math.min(1100, Math.round(value))) : 440
            );
        }
        if (elements.galleryTransitionManualMs) {
            const value = Number(state.settings?.library?.performance?.galleryTransitionManualMs);
            elements.galleryTransitionManualMs.value = String(
                Number.isFinite(value) ? Math.max(120, Math.min(500, Math.round(value))) : 190
            );
        }
        if (elements.gallerySlideshowLoop) {
            elements.gallerySlideshowLoop.checked = state.settings?.library?.performance?.gallerySlideshowLoop !== false;
        }
        if (elements.gallerySlideshowShuffle) {
            elements.gallerySlideshowShuffle.checked = !!state.settings?.library?.performance?.gallerySlideshowShuffle;
        }
        if (elements.libraryCoverCacheLimitMb) {
            elements.libraryCoverCacheLimitMb.value = String(state.settings?.library?.performance?.coverCacheLimitMb || 64);
        }
        if (elements.libraryVideoCount) {
            elements.libraryVideoCount.textContent = String(Array.isArray(state.videoFiles) ? state.videoFiles.length : 0);
        }
        if (elements.libraryMusicPathInfo) {
            elements.libraryMusicPathInfo.textContent = translate?.(
                'settings.library.musicPath.dynamic',
                'Music folder: {path}',
                { path: specialPaths?.music || '-' }
            ) || `Music folder: ${specialPaths?.music || '-'}`;
        }
        if (elements.libraryVideoPathInfo) {
            elements.libraryVideoPathInfo.textContent = translate?.(
                'settings.library.videoPath.dynamic',
                'Video folder: {path}',
                { path: specialPaths?.videos || '-' }
            ) || `Video folder: ${specialPaths?.videos || '-'}`;
        }

        if (elements.languageSelect) {
            elements.languageSelect.value = String(
                state.settings?.ui?.language
                || state.settings?.lang
                || navigator.language
                || 'tr-TR'
            );
        }
        if (elements.themeSelect) {
            elements.themeSelect.value = String(state.settings?.appearance?.theme || 'aur-renk-efektleri');
        }
        const modePreset = visualModePreset(state.settings?.appearance?.visualMode || 'full');
        if (elements.uiVisualModeSelect) {
            elements.uiVisualModeSelect.value = modePreset.visualMode;
        }
        if (elements.uiMotionProfileSelect) {
            elements.uiMotionProfileSelect.value = normalizeMotionProfile(state.settings?.appearance?.motionProfile);
        }
        if (elements.uiFollowSystemThemeToggle) {
            elements.uiFollowSystemThemeToggle.checked = !!state.settings?.appearance?.followSystemTheme;
        }
        if (elements.uiFxEnabledToggle) {
            elements.uiFxEnabledToggle.checked = state.settings?.appearance?.uiFxEnabled !== false;
        }
        if (elements.uiReduceMotionToggle) {
            elements.uiReduceMotionToggle.checked = !!state.settings?.appearance?.reduceMotion;
        }
        if (elements.sliderFxToggle) {
            elements.sliderFxToggle.checked = state.settings?.appearance?.sliderFxEnabled !== false;
        }
        if (elements.sfxLightsToggle) {
            elements.sfxLightsToggle.checked = state.settings?.appearance?.sfxLights !== false;
        }
        if (elements.uiSfxIconSizeSelect) {
            elements.uiSfxIconSizeSelect.value = normalizeSfxIconSize(state.settings?.appearance?.sfxSidebarIconSize);
        }
        if (elements.uiAutoHardwareProfileToggle) {
            elements.uiAutoHardwareProfileToggle.checked = state.settings?.appearance?.autoHardwareProfile !== false;
        }
        if (elements.uiLowHardwareModeToggle) {
            elements.uiLowHardwareModeToggle.checked = !!state.settings?.appearance?.lowHardwareMode;
        }
        if (elements.securityAllowPopups) {
            elements.securityAllowPopups.checked = state.settings?.security?.allowPopups !== false;
        }
        if (elements.securityEnforceAllowlist) {
            elements.securityEnforceAllowlist.checked = !!state.settings?.security?.enforceAllowlist;
        }
        if (elements.securitySessionProfile) {
            const profile = String(state.settings?.security?.sessionProfile || 'persistent').toLowerCase();
            elements.securitySessionProfile.value = profile === 'isolated' ? 'isolated' : 'persistent';
        }

        if (elements.audioDefaultVolume) {
            const allow150 = !!state.settings?.audioOutput?.allowOverdrive150;
            const volume = Math.max(0, Math.min(allow150 ? 150 : 100, Number(state.settings?.audioOutput?.defaultVolume ?? 40)));
            elements.audioDefaultVolume.value = String(volume);
            if (elements.audioDefaultVolumeValue) elements.audioDefaultVolumeValue.textContent = `${volume}%`;
        }
        if (elements.audioAppVolume) {
            const appVolume = Math.max(0, Math.min(100, Number(state.settings?.volume ?? state.volume ?? 40)));
            elements.audioAppVolume.value = String(appVolume);
            if (elements.audioAppVolumeValue) elements.audioAppVolumeValue.textContent = `${appVolume}%`;
        }
        if (elements.audioFollowSystemVolume) {
            elements.audioFollowSystemVolume.checked = state.settings?.audioOutput?.followSystemVolume !== false;
        }
        if (elements.audioAllowOverdrive150) {
            setButtonToggleState(elements.audioAllowOverdrive150, !!state.settings?.audioOutput?.allowOverdrive150);
        }
        if (elements.audioLoudnessEnabled) {
            elements.audioLoudnessEnabled.checked = !!state.settings?.audioOutput?.loudnessEnabled;
        }
        if (elements.audioLoudnessMode) {
            const loudnessMode = String(state.settings?.audioOutput?.loudnessMode || 'balanced').toLowerCase();
            elements.audioLoudnessMode.value = ['gentle', 'balanced', 'strong'].includes(loudnessMode) ? loudnessMode : 'balanced';
        }
        if (elements.audioLimiterEnabled) {
            elements.audioLimiterEnabled.checked = !!state.settings?.audioOutput?.limiterEnabled;
        }
        if (elements.audioLimiterMode) {
            const limiterMode = String(state.settings?.audioOutput?.limiterMode || 'balanced').toLowerCase();
            elements.audioLimiterMode.value = ['soft', 'balanced', 'strict'].includes(limiterMode) ? limiterMode : 'balanced';
        }
        if (elements.audioNightModeEnabled) {
            elements.audioNightModeEnabled.checked = !!state.settings?.audioOutput?.nightModeEnabled;
        }
        if (elements.audioNightModeLevel) {
            const nightModeLevel = String(state.settings?.audioOutput?.nightModeLevel || 'balanced').toLowerCase();
            elements.audioNightModeLevel.value = ['light', 'balanced', 'strong'].includes(nightModeLevel) ? nightModeLevel : 'balanced';
        }
        if (elements.audioProfileCards?.length) {
            const profile = String(state.settings?.audioOutput?.profile || 'music').toLowerCase();
            elements.audioProfileCards.forEach((card) => {
                card.classList.toggle('is-active', String(card.dataset.audioProfile || '').toLowerCase() === profile);
            });
        }
        if (elements.audioSpatialCards?.length) {
            const spatialMode = String(state.settings?.audioOutput?.spatialMode || 'stereo').toLowerCase();
            elements.audioSpatialCards.forEach((card) => {
                card.classList.toggle('is-active', String(card.dataset.audioSpatial || '').toLowerCase() === spatialMode);
            });
        }
        if (elements.audioVideoDelay) {
            const audioDelayMs = Math.max(0, Math.min(500, Number(state.settings?.videoFullscreen?.audioDelayMs || 0)));
            elements.audioVideoDelay.value = String(audioDelayMs);
            if (elements.audioVideoDelayValue) elements.audioVideoDelayValue.textContent = `${audioDelayMs} ms`;
        }
        if (elements.audioStableVolume) {
            elements.audioStableVolume.checked = !!state.settings?.videoFullscreen?.stableVolume;
        }
        if (elements.audioVolumeBoost) {
            elements.audioVolumeBoost.checked = !!state.settings?.videoFullscreen?.volumeBoost;
        }

        updateAdblockModeUI?.();
        updateAdblockBadge?.(blockedCount);
    }

    async function applySettings({
        state,
        elements,
        ensureAdblockSettings,
        readAdblockSettingsFromUI,
        applyAdblockRuntimeConfig,
        updateAdblockBadge,
        blockedCount,
        normalizeAdblockMode,
        saveSettings,
        normalizePulsePreferenceState,
        pulseDefaultSec,
        pulseDefaultMode,
        savePulsePreferences,
        notifyPulseSaveError
    }) {
        if (!state?.settings) return;

        const prevAdblock = {
            ...ensureAdblockSettings()
        };

        const crossfadeStop = document.getElementById('crossfadeStop');
        const crossfadeManual = document.getElementById('crossfadeManual');
        const crossfadeAuto = document.getElementById('crossfadeAuto');
        const sameAlbumNoCrossfade = document.getElementById('sameAlbumNoCrossfade');
        const crossfadeMs = document.getElementById('crossfadeMs');
        const fadeOnPause = document.getElementById('fadeOnPause');
        const pauseFadeMs = document.getElementById('pauseFadeMs');
        const crossfadeSkipShortTracks = document.getElementById('crossfadeSkipShortTracks');
        const crossfadeSafetyPaddingMs = document.getElementById('crossfadeSafetyPaddingMs');
        const seekStepSeconds = document.getElementById('seekStepSeconds');
        const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
        const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
        const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
        const endWarningEnabled = document.getElementById('endWarningEnabled');
        const endWarningSeconds = document.getElementById('endWarningSeconds');
        const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
        const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
        const mediaKeyAutoDetect = document.getElementById('mediaKeyAutoDetect');
        const browserNavigationHotkeysEnabled = document.getElementById('browserNavigationHotkeysEnabled');
        const galleryHotkeysEnabled = document.getElementById('galleryHotkeysEnabled');
        const shortcutPrevious = document.getElementById('shortcutPrevious');
        const shortcutPlayPause = document.getElementById('shortcutPlayPause');
        const shortcutNext = document.getElementById('shortcutNext');
        const navigationShortcuts = Object.entries(NAVIGATION_SHORTCUT_FIELD_MAP).reduce((acc, [key, fieldId]) => {
            const input = document.getElementById(fieldId);
            acc[key] = normalizeNavigationShortcut(input?.value);
            return acc;
        }, {});
        const galleryShortcuts = Object.entries(GALLERY_SHORTCUT_FIELD_MAP).reduce((acc, [key, fieldId]) => {
            const input = document.getElementById(fieldId);
            acc[key] = normalizeNavigationShortcut(input?.value);
            return acc;
        }, {});
        if (galleryHotkeysEnabled?.checked === true) {
            const hasAnyAssigned = Object.values(galleryShortcuts).some((value) => !isShortcutInputEmpty(value));
            if (!hasAnyAssigned) {
                Object.entries(GALLERY_SHORTCUT_DEFAULTS).forEach(([key, value]) => {
                    galleryShortcuts[key] = normalizeNavigationShortcut(value);
                });
            }
        }
        const crossfadeMsValue = Math.max(0, Math.min(15000, parseInt(crossfadeMs?.value || '2000', 10) || 2000));
        const pauseFadeMsValue = Math.max(0, Math.min(5000, parseInt(pauseFadeMs?.value || '250', 10) || 250));
        const crossfadeSafetyPaddingMsValue = Math.max(0, Math.min(5000, parseInt(crossfadeSafetyPaddingMs?.value || '300', 10) || 300));
        const seekStepSecondsValue = Math.max(1, Math.min(60, parseInt(seekStepSeconds?.value || '10', 10) || 10));
        const endWarningSecondsValue = Math.max(3, Math.min(60, parseInt(endWarningSeconds?.value || '10', 10) || 10));
        const smartVolumeLevelingModeValue = String(smartVolumeLevelingMode?.value || 'balanced').toLowerCase();

        state.settings.playback = {
            crossfadeStopEnabled: !!crossfadeStop?.checked,
            crossfadeManualEnabled: !!crossfadeManual?.checked,
            crossfadeAutoEnabled: !!crossfadeAuto?.checked,
            sameAlbumNoCrossfade: !!sameAlbumNoCrossfade?.checked,
            crossfadeMs: crossfadeMsValue,
            fadeOnPauseResume: !!fadeOnPause?.checked,
            pauseFadeMs: pauseFadeMsValue,
            crossfadeSkipShortTracks: crossfadeSkipShortTracks?.checked !== false,
            crossfadeSafetyPaddingMs: crossfadeSafetyPaddingMsValue,
            seekStepSeconds: seekStepSecondsValue,
            restoreLastTrackOnStartup: restoreLastTrackOnStartup?.checked !== false,
            autoplayLastTrackOnStartup: !!autoplayLastTrackOnStartup?.checked,
            resumePositionOnStartup: resumePositionOnStartup?.checked !== false,
            endWarningEnabled: !!endWarningEnabled?.checked,
            endWarningSeconds: endWarningSecondsValue,
            smartVolumeLevelingEnabled: !!smartVolumeLevelingEnabled?.checked,
            smartVolumeLevelingMode: ['gentle', 'balanced', 'strong'].includes(smartVolumeLevelingModeValue)
                ? smartVolumeLevelingModeValue
                : 'balanced',
            mediaKeyAutoDetect: mediaKeyAutoDetect?.checked !== false,
            browserNavigationHotkeysEnabled: browserNavigationHotkeysEnabled?.checked !== false,
            galleryHotkeysEnabled: galleryHotkeysEnabled?.checked === true,
            customHotkeys: {
                previous: normalizePlaybackShortcutCode(shortcutPrevious?.value, 'none'),
                playPause: normalizePlaybackShortcutCode(shortcutPlayPause?.value, 'none'),
                next: normalizePlaybackShortcutCode(shortcutNext?.value, 'none')
            },
            navigationShortcuts,
            galleryShortcuts,
            startupState: state.settings?.playback?.startupState && typeof state.settings.playback.startupState === 'object'
                ? state.settings.playback.startupState
                : {}
        };

        if (!state.settings.pulseQuick || typeof state.settings.pulseQuick !== 'object') {
            state.settings.pulseQuick = {};
        }

        const sec = Number(elements.pulseNoSignalHintSec?.value);
        state.settings.pulseQuick.noSignalHintSec = [4, 6, 8].includes(sec) ? sec : pulseDefaultSec;
        let formMode = String(elements.pulseQuickMode?.value || '').trim().toLowerCase();
        if (!formMode && elements.pulseQuickModeCards?.length) {
            elements.pulseQuickModeCards.forEach(card => {
                if (card.classList.contains('active')) {
                    formMode = String(card.dataset.pulseQuickMode || '').trim().toLowerCase();
                }
            });
        }
        const mode = formMode || pulseDefaultMode;
        state.settings.pulseQuick.mode = ['normal', 'background', 'max'].includes(mode) ? mode : pulseDefaultMode;
        console.log('[SETTINGS] applySettings saved pulseQuick mode:', state.settings.pulseQuick.mode);
        const existingPulsePrefs = normalizePulsePreferenceState(state.settings?.pulsePreferences);
        const requestIntervalInput = Number(elements.pulseRequestInterval?.value);
        const bufferSizeInput = Number(elements.pulseBufferSize?.value);

        state.settings.pulsePreferences = normalizePulsePreferenceState({
            ...existingPulsePrefs,
            enable_notifications: elements.pulseEnableNotifications
                ? !!elements.pulseEnableNotifications.checked
                : existingPulsePrefs.enable_notifications,
            enable_mpris: elements.pulseEnableMpris
                ? !!elements.pulseEnableMpris.checked
                : existingPulsePrefs.enable_mpris,
            enable_systray: elements.pulseEnableSystray
                ? !!elements.pulseEnableSystray.checked
                : existingPulsePrefs.enable_systray,
            no_duplicates: elements.pulseNoDuplicates
                ? !!elements.pulseNoDuplicates.checked
                : existingPulsePrefs.no_duplicates,
            request_interval_secs_v3: elements.pulseRequestInterval && Number.isFinite(requestIntervalInput)
                ? requestIntervalInput
                : existingPulsePrefs.request_interval_secs_v3,
            buffer_size_secs: elements.pulseBufferSize && Number.isFinite(bufferSizeInput)
                ? bufferSizeInput
                : existingPulsePrefs.buffer_size_secs,
            recognition_engine: elements.pulseRecognitionEngine
                ? String(elements.pulseRecognitionEngine.value || existingPulsePrefs.recognition_engine || 'songrec_only')
                : existingPulsePrefs.recognition_engine,
            acoustid_api_key: elements.pulseAcoustidApiKey
                ? String(elements.pulseAcoustidApiKey.value || '')
                : existingPulsePrefs.acoustid_api_key
        });

        if (!state.settings.ui || typeof state.settings.ui !== 'object') state.settings.ui = {};
        const nextLanguage = String(
            elements.languageSelect?.value
            || state.settings.ui.language
            || state.settings.lang
            || navigator.language
            || 'tr-TR'
        );
        state.settings.ui.language = nextLanguage;
        state.settings.lang = nextLanguage;
        if (!state.settings.appearance || typeof state.settings.appearance !== 'object') state.settings.appearance = {};
        const prevAutoHardwareProfile = state.settings.appearance.autoHardwareProfile !== false;
        const nextAutoHardwareProfile = !!elements.uiAutoHardwareProfileToggle?.checked;
        const modePresetForApply = visualModePreset(elements.uiVisualModeSelect?.value || state.settings.appearance.visualMode || 'full');
        state.settings.appearance.theme = String(elements.themeSelect?.value || state.settings.appearance.theme || 'aur-renk-efektleri');
        state.settings.appearance.followSystemTheme = !!elements.uiFollowSystemThemeToggle?.checked;
        state.settings.appearance.visualMode = modePresetForApply.visualMode;
        state.settings.appearance.motionProfile = normalizeMotionProfile(
            elements.uiMotionProfileSelect?.value || state.settings.appearance.motionProfile || 'balanced'
        );
        state.settings.appearance.uiFxEnabled = !!elements.uiFxEnabledToggle?.checked;
        state.settings.appearance.sliderFxEnabled = !!elements.sliderFxToggle?.checked;
        state.settings.appearance.reduceMotion = !!elements.uiReduceMotionToggle?.checked;
        state.settings.appearance.sfxLights = !!elements.sfxLightsToggle?.checked;
        state.settings.appearance.sfxSidebarIconSize = normalizeSfxIconSize(
            elements.uiSfxIconSizeSelect?.value || state.settings.appearance.sfxSidebarIconSize || 'medium'
        );
        state.settings.appearance.autoHardwareProfile = nextAutoHardwareProfile;
        state.settings.appearance.lowHardwareMode = !!elements.uiLowHardwareModeToggle?.checked;
        if (prevAutoHardwareProfile && !nextAutoHardwareProfile) {
            // Auto optimize kapatılırken tam güç varsayılanını kayda da kesin yansıt.
            state.settings.appearance.sliderFxEnabled = true;
            state.settings.appearance.sfxLights = true;
            if (elements.sliderFxToggle) elements.sliderFxToggle.checked = true;
            if (elements.sfxLightsToggle) elements.sfxLightsToggle.checked = true;
        }
        const rememberLastSectionValue =
            (typeof elements.behaviorRememberLastSection?.checked === 'boolean')
                ? !!elements.behaviorRememberLastSection.checked
                : !!elements.libraryRememberSection?.checked;
        state.settings.ui.rememberLastSection = rememberLastSectionValue;
        state.settings.ui.webExperienceEnabled =
            (typeof elements.behaviorWebExperienceEnabled?.checked === 'boolean')
                ? !!elements.behaviorWebExperienceEnabled.checked
                : (state.settings.ui.webExperienceEnabled === true);
        const allowWebStartup = state.settings.ui.webExperienceEnabled === true;
        const startupPage = String(
            elements.behaviorStartupPage?.value
            || elements.libraryStartupPage?.value
            || 'music'
        ).toLowerCase();
        const allowedStartupPages = allowWebStartup ? ['music', 'video', 'videotools', 'web'] : ['music', 'video', 'videotools'];
        state.settings.ui.startupPage = allowedStartupPages.includes(startupPage) ? startupPage : 'music';
        const webStartupLazyDelayMs = normalizeWebStartupLazyDelayMs(
            elements.behaviorWebStartupDelay?.value
            || elements.libraryWebStartupDelay?.value
            || state.settings.ui.webStartupLazyDelayMs
        );
        state.settings.ui.webStartupLazyDelayMs = webStartupLazyDelayMs;
        state.settings.ui.closeToTray =
            (typeof elements.behaviorCloseToTray?.checked === 'boolean')
                ? !!elements.behaviorCloseToTray.checked
                : true;
        state.settings.ui.notificationsEnabled =
            (typeof elements.behaviorNotificationsEnabled?.checked === 'boolean')
                ? !!elements.behaviorNotificationsEnabled.checked
                : false;
        if (!state.settings.webUi || typeof state.settings.webUi !== 'object') {
            state.settings.webUi = {};
        }
        state.settings.webUi.animationMode =
            String(elements.behaviorWebAnimationMode?.value || state.settings.webUi.animationMode || 'compact').toLowerCase() === 'dock'
                ? 'dock'
                : 'compact';
        state.settings.webUi.motionPreset = normalizeWebMotionPreset(
            elements.behaviorWebMotionPreset?.value
            || state.settings.webUi.motionPreset
            || 'balanced'
        );
        state.settings.webUi.lowPowerMode = !!elements.behaviorWebLowPowerMode?.checked;
        if (!state.settings.security || typeof state.settings.security !== 'object') state.settings.security = {};
        state.settings.security.allowPopups = !!elements.securityAllowPopups?.checked;
        state.settings.security.enforceAllowlist = !!elements.securityEnforceAllowlist?.checked;
        state.settings.security.sessionProfile =
            String(elements.securitySessionProfile?.value || state.settings.security.sessionProfile || 'persistent').toLowerCase() === 'isolated'
                ? 'isolated'
                : 'persistent';
        if (!state.settings.library || typeof state.settings.library !== 'object') state.settings.library = {};
        state.settings.library.restoreLastFolder = !!elements.libraryRestoreLastFolder?.checked;
        state.settings.library.restoreLastPlaylist = !!elements.libraryRestoreLastPlaylist?.checked;
        state.settings.library.rememberTreeSelection = !!elements.libraryRememberTreeSelection?.checked;
        state.settings.library.scanOnStartup = !!elements.libraryScanOnStartup?.checked;
        state.settings.library.autoRescanOnFolderChange = !!elements.libraryAutoRescanOnFolderChange?.checked;
        state.settings.library.watchFolders = !!elements.libraryWatchFolders?.checked;
        state.settings.library.preferEmbeddedCover = !!elements.libraryPreferEmbeddedCover?.checked;
        state.settings.library.scanFolderCover = !!elements.libraryScanFolderCover?.checked;
        state.settings.library.markMissingCovers = !!elements.libraryMarkMissingCovers?.checked;
        const libraryViewSortValue = String(elements.libraryViewSort?.value || '').toLowerCase();
        state.settings.library.viewSort = ['title', 'artist', 'album', 'added'].includes(libraryViewSortValue)
            ? libraryViewSortValue
            : 'title';
        const libraryViewGroupValue = String(elements.libraryViewGroup?.value || '').toLowerCase();
        state.settings.library.viewGroup = ['none', 'artist', 'album'].includes(libraryViewGroupValue)
            ? libraryViewGroupValue
            : 'none';
        const libraryViewModeValue = String(elements.libraryViewMode?.value || '').toLowerCase();
        state.settings.library.viewMode = ['list', 'compact', 'comfortable', 'cards'].includes(libraryViewModeValue)
            ? libraryViewModeValue
            : 'list';
        state.settings.library.audioExtensions = String(elements.libraryAudioExtensions?.value || '')
            .split(',')
            .map((value) => value.trim().replace(/^\./, '').toLowerCase())
            .filter(Boolean);
        state.settings.library.videoExtensions = String(elements.libraryVideoExtensions?.value || '')
            .split(',')
            .map((value) => value.trim().replace(/^\./, '').toLowerCase())
            .filter(Boolean);
        if (!state.settings.library.smartFlows || typeof state.settings.library.smartFlows !== 'object') {
            state.settings.library.smartFlows = {};
        }
        state.settings.library.smartFlows.favoritesEnabled = !!elements.libraryFlowFavoritesEnabled?.checked;
        state.settings.library.smartFlows.recentEnabled = !!elements.libraryFlowRecentEnabled?.checked;
        state.settings.library.smartFlows.mostPlayedEnabled = !!elements.libraryFlowMostPlayedEnabled?.checked;
        const recentLimitValue = Number(elements.libraryFlowRecentLimit?.value);
        state.settings.library.smartFlows.recentLimit = [10, 25, 50].includes(recentLimitValue)
            ? recentLimitValue
            : 25;
        const mostPlayedLimitValue = Number(elements.libraryFlowMostPlayedLimit?.value);
        state.settings.library.smartFlows.mostPlayedLimit = [10, 25, 50].includes(mostPlayedLimitValue)
            ? mostPlayedLimitValue
            : 25;
        if (!state.settings.library.performance || typeof state.settings.library.performance !== 'object') {
            state.settings.library.performance = {};
        }
        state.settings.library.performance.fastScan = !!elements.libraryFastScan?.checked;
        state.settings.library.performance.lightweightMode = !!elements.libraryLightweightMode?.checked;
        state.settings.library.performance.scanSubfolders = !!elements.libraryScanSubfolders?.checked;
        const galleryPageJumpValue = Number(elements.libraryGalleryPageJump?.value);
        state.settings.library.performance.galleryPageJump = Number.isFinite(galleryPageJumpValue)
            ? Math.max(1, Math.min(30, Math.round(galleryPageJumpValue)))
            : 6;
        const gallerySlideshowIntervalMsValue = Number(elements.gallerySlideshowIntervalMs?.value);
        state.settings.library.performance.gallerySlideshowIntervalMs = Number.isFinite(gallerySlideshowIntervalMsValue)
            ? Math.max(1000, Math.min(15000, Math.round(gallerySlideshowIntervalMsValue)))
            : 3000;
        const galleryFastThresholdValue = Number(elements.gallerySlideshowFastThresholdMs?.value);
        const gallerySlowThresholdValue = Number(elements.gallerySlideshowSlowThresholdMs?.value);
        const safeFastThreshold = Number.isFinite(galleryFastThresholdValue)
            ? Math.max(1000, Math.min(14000, Math.round(galleryFastThresholdValue)))
            : 2500;
        const safeSlowThreshold = Number.isFinite(gallerySlowThresholdValue)
            ? Math.max(1500, Math.min(15000, Math.round(gallerySlowThresholdValue)))
            : 5000;
        state.settings.library.performance.galleryFastThresholdMs = Math.min(safeFastThreshold, safeSlowThreshold - 500);
        state.settings.library.performance.gallerySlowThresholdMs = Math.max(safeSlowThreshold, state.settings.library.performance.galleryFastThresholdMs + 500);
        const galleryTransitionSlideshowValue = Number(elements.galleryTransitionSlideshowMs?.value);
        state.settings.library.performance.galleryTransitionSlideshowMs = Number.isFinite(galleryTransitionSlideshowValue)
            ? Math.max(280, Math.min(1100, Math.round(galleryTransitionSlideshowValue)))
            : 440;
        const galleryTransitionManualValue = Number(elements.galleryTransitionManualMs?.value);
        state.settings.library.performance.galleryTransitionManualMs = Number.isFinite(galleryTransitionManualValue)
            ? Math.max(120, Math.min(500, Math.round(galleryTransitionManualValue)))
            : 190;
        state.settings.library.performance.gallerySlideshowLoop = !!elements.gallerySlideshowLoop?.checked;
        state.settings.library.performance.gallerySlideshowShuffle = !!elements.gallerySlideshowShuffle?.checked;
        const coverCacheLimitValue = Number(elements.libraryCoverCacheLimitMb?.value);
        state.settings.library.performance.coverCacheLimitMb = [32, 64, 128, 256].includes(coverCacheLimitValue)
            ? coverCacheLimitValue
            : 64;

        if (state.settings.appearance.lowHardwareMode) {
            state.settings.ui.webStartupLazyDelayMs = 2000;
            state.settings.library.watchFolders = false;
            state.settings.library.autoRescanOnFolderChange = false;
            state.settings.library.performance.lightweightMode = true;
            state.settings.library.performance.coverCacheLimitMb = 32;
            state.settings.library.smartFlows.favoritesEnabled = false;
            state.settings.library.smartFlows.recentEnabled = false;
            state.settings.library.smartFlows.mostPlayedEnabled = false;
        }

        state.settings.volume = Math.max(0, Math.min(100, Number(elements.audioAppVolume?.value || state.settings.volume || 40)));
        if (!state.settings.audioOutput || typeof state.settings.audioOutput !== 'object') {
            state.settings.audioOutput = {};
        }
        state.settings.audioOutput.defaultVolume = Math.max(
            0,
            Math.min(
                getButtonToggleState(elements.audioAllowOverdrive150) ? 150 : 100,
                Number(elements.audioDefaultVolume?.value || state.settings.audioOutput.defaultVolume || 40)
            )
        );
        state.settings.audioOutput.followSystemVolume = !!elements.audioFollowSystemVolume?.checked;
        state.settings.audioOutput.allowOverdrive150 = getButtonToggleState(elements.audioAllowOverdrive150);
        state.settings.audioOutput.loudnessEnabled = !!elements.audioLoudnessEnabled?.checked;
        const audioLoudnessModeValue = String(elements.audioLoudnessMode?.value || '').toLowerCase();
        state.settings.audioOutput.loudnessMode = ['gentle', 'balanced', 'strong'].includes(audioLoudnessModeValue)
            ? audioLoudnessModeValue
            : 'balanced';
        state.settings.audioOutput.limiterEnabled = !!elements.audioLimiterEnabled?.checked;
        const audioLimiterModeValue = String(elements.audioLimiterMode?.value || '').toLowerCase();
        state.settings.audioOutput.limiterMode = ['soft', 'balanced', 'strict'].includes(audioLimiterModeValue)
            ? audioLimiterModeValue
            : 'balanced';
        state.settings.audioOutput.nightModeEnabled = !!elements.audioNightModeEnabled?.checked;
        const audioNightModeLevelValue = String(elements.audioNightModeLevel?.value || '').toLowerCase();
        state.settings.audioOutput.nightModeLevel = ['light', 'balanced', 'strong'].includes(audioNightModeLevelValue)
            ? audioNightModeLevelValue
            : 'balanced';
        if (elements.audioSpatialCards?.length) {
            const activeSpatial = Array.from(elements.audioSpatialCards).find((card) => card.classList.contains('is-active'));
            state.settings.audioOutput.spatialMode = ['mono', 'stereo', 'spatial'].includes(String(activeSpatial?.dataset.audioSpatial || '').toLowerCase())
                ? String(activeSpatial.dataset.audioSpatial).toLowerCase()
                : 'stereo';
        } else {
            state.settings.audioOutput.spatialMode = String(state.settings.audioOutput.spatialMode || 'stereo').toLowerCase();
        }
        if (elements.audioProfileCards?.length) {
            const activeProfile = Array.from(elements.audioProfileCards).find((card) => card.classList.contains('is-active'));
            state.settings.audioOutput.profile = String(activeProfile?.dataset.audioProfile || state.settings.audioOutput.profile || 'music').toLowerCase();
        } else {
            state.settings.audioOutput.profile = String(state.settings.audioOutput.profile || 'music').toLowerCase();
        }
        if (!state.settings.videoFullscreen || typeof state.settings.videoFullscreen !== 'object') {
            state.settings.videoFullscreen = {};
        }
        state.settings.videoFullscreen.audioDelayMs = Math.max(0, Math.min(500, Number(elements.audioVideoDelay?.value || state.settings.videoFullscreen.audioDelayMs || 0)));
        state.settings.videoFullscreen.stableVolume = !!elements.audioStableVolume?.checked;
        state.settings.videoFullscreen.volumeBoost = !!elements.audioVolumeBoost?.checked;

        state.settings.adblock = readAdblockSettingsFromUI();
        applyAdblockRuntimeConfig?.();
        updateAdblockBadge?.(blockedCount);

        const nextMode = normalizeAdblockMode(state.settings.adblock?.mode);
        const prevMode = normalizeAdblockMode(prevAdblock.mode);
        await Promise.resolve(saveSettings?.());
        const editsPulsePreferences = !!(
            elements.pulseEnableNotifications
            || elements.pulseEnableMpris
            || elements.pulseEnableSystray
            || elements.pulseNoDuplicates
            || elements.pulseRequestInterval
            || elements.pulseBufferSize
            || elements.pulseRecognitionEngine
            || elements.pulseAcoustidApiKey
        );
        if (editsPulsePreferences) {
            try {
                await Promise.resolve(savePulsePreferences?.(state.settings.pulsePreferences));
            } catch (error) {
                notifyPulseSaveError?.(error);
            }
        }

        return { nextMode, prevMode };
    }

    function resetPlaybackDefaults() {
        const crossfadeStop = document.getElementById('crossfadeStop');
        const crossfadeManual = document.getElementById('crossfadeManual');
        const crossfadeAuto = document.getElementById('crossfadeAuto');
        const sameAlbumNoCrossfade = document.getElementById('sameAlbumNoCrossfade');
        const crossfadeMs = document.getElementById('crossfadeMs');
        const fadeOnPause = document.getElementById('fadeOnPause');
        const pauseFadeMs = document.getElementById('pauseFadeMs');
        const crossfadeSkipShortTracks = document.getElementById('crossfadeSkipShortTracks');
        const crossfadeSafetyPaddingMs = document.getElementById('crossfadeSafetyPaddingMs');
        const seekStepSeconds = document.getElementById('seekStepSeconds');
        const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
        const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
        const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
        const endWarningEnabled = document.getElementById('endWarningEnabled');
        const endWarningSeconds = document.getElementById('endWarningSeconds');
        const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
        const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
        const mediaKeyAutoDetect = document.getElementById('mediaKeyAutoDetect');
        const browserNavigationHotkeysEnabled = document.getElementById('browserNavigationHotkeysEnabled');
        const galleryHotkeysEnabled = document.getElementById('galleryHotkeysEnabled');
        const shortcutPrevious = document.getElementById('shortcutPrevious');
        const shortcutPlayPause = document.getElementById('shortcutPlayPause');
        const shortcutNext = document.getElementById('shortcutNext');

        if (crossfadeStop) crossfadeStop.checked = true;
        if (crossfadeManual) crossfadeManual.checked = true;
        if (crossfadeAuto) crossfadeAuto.checked = false;
        if (sameAlbumNoCrossfade) {
            sameAlbumNoCrossfade.checked = true;
            sameAlbumNoCrossfade.disabled = true;
        }
        if (crossfadeMs) crossfadeMs.value = '2000';
        if (fadeOnPause) fadeOnPause.checked = false;
        if (pauseFadeMs) pauseFadeMs.value = '250';
        if (crossfadeSkipShortTracks) crossfadeSkipShortTracks.checked = true;
        if (crossfadeSafetyPaddingMs) crossfadeSafetyPaddingMs.value = '300';
        if (seekStepSeconds) seekStepSeconds.value = '10';
        if (restoreLastTrackOnStartup) restoreLastTrackOnStartup.checked = true;
        if (autoplayLastTrackOnStartup) autoplayLastTrackOnStartup.checked = false;
        if (resumePositionOnStartup) resumePositionOnStartup.checked = true;
        if (endWarningEnabled) endWarningEnabled.checked = false;
        if (endWarningSeconds) endWarningSeconds.value = '10';
        if (smartVolumeLevelingEnabled) smartVolumeLevelingEnabled.checked = false;
        if (smartVolumeLevelingMode) smartVolumeLevelingMode.value = 'balanced';
        if (mediaKeyAutoDetect) mediaKeyAutoDetect.checked = true;
        if (browserNavigationHotkeysEnabled) browserNavigationHotkeysEnabled.checked = true;
        if (galleryHotkeysEnabled) galleryHotkeysEnabled.checked = true;
        if (shortcutPrevious) shortcutPrevious.value = 'none';
        if (shortcutPlayPause) shortcutPlayPause.value = 'none';
        if (shortcutNext) shortcutNext.value = 'none';
        Object.values(NAVIGATION_SHORTCUT_FIELD_MAP).forEach((fieldId) => {
            const input = document.getElementById(fieldId);
            if (input) input.value = '';
        });
        applyDefaultGalleryShortcutsToUi({ force: true });
        updateGalleryShortcutAssignmentsUi({ autofillDefaults: false });
    }

    function resetGalleryShortcutDefaults() {
        const galleryHotkeysEnabled = document.getElementById('galleryHotkeysEnabled');
        if (galleryHotkeysEnabled) galleryHotkeysEnabled.checked = true;
        applyDefaultGalleryShortcutsToUi({ force: true });
        updateGalleryShortcutAssignmentsUi({ autofillDefaults: false });
    }

    function resetListenDefaults({ elements, defaultSec, defaultMode, updatePulseQuickModeUi }) {
        if (elements.pulseNoSignalHintSec) {
            elements.pulseNoSignalHintSec.value = String(defaultSec);
        }
        if (elements.pulseQuickMode) {
            elements.pulseQuickMode.value = defaultMode;
            updatePulseQuickModeUi?.();
        }
    }

    function updateAudioSettingsVolumeLabel(elements) {
        if (!elements?.audioDefaultVolume || !elements?.audioDefaultVolumeValue) return;
        const sliderMax = Math.max(100, Number(elements.audioDefaultVolume.max) || 100);
        const value = Math.max(0, Math.min(sliderMax, Number(elements.audioDefaultVolume.value) || 0));
        elements.audioDefaultVolumeValue.textContent = `${value}%`;
    }

    function updateAudioAppVolumeLabel(elements) {
        if (!elements?.audioAppVolume || !elements?.audioAppVolumeValue) return;
        const value = Math.max(0, Math.min(100, Number(elements.audioAppVolume.value) || 0));
        elements.audioAppVolumeValue.textContent = `${value}%`;
    }

    window.AurivoSettingsShared = {
        switchSettingsTab,
        updatePulseQuickModeUi,
        loadSettingsToUI,
        applySettings,
        getButtonToggleState,
        setButtonToggleState,
        resetPlaybackDefaults,
        resetGalleryShortcutDefaults,
        resetListenDefaults,
        updateGalleryShortcutAssignmentsUi,
        updateAudioSettingsVolumeLabel,
        updateAudioAppVolumeLabel
    };
})();
