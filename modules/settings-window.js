(function attachAurivoSettingsWindowApi() {
    function setupStandaloneEventListeners(deps) {
        const {
            elements,
            closeRestartModal,
            confirmAndRelaunchApp,
            closeSettings,
            applySettings,
            resetPlaybackDefaults,
            resetListenDefaults,
            resetCurrentSettingsTab,
            getActiveSettingsTabName,
            getSettingsTabLabel,
            updatePulseQuickModeUi,
            openAdblockDashboardPanel,
            refreshAdblockStats,
            setAdblockMode,
            readAdblockSettingsFromUI,
            updateAdblockBadge,
            handleKeyboard,
            setupSecurityUI,
            startAdblockStatsPolling
        } = deps || {};

        if (!elements) return;

        if (elements.restartModalClose) elements.restartModalClose.addEventListener('click', closeRestartModal);
        if (elements.restartModalNo) elements.restartModalNo.addEventListener('click', closeRestartModal);
        if (elements.restartModalYes) {
            elements.restartModalYes.addEventListener('click', async () => {
                if (typeof confirmAndRelaunchApp === 'function') {
                    await confirmAndRelaunchApp();
                    return;
                }
                try {
                    const ok = await window.aurivo?.app?.relaunch?.();
                    if (!ok) closeRestartModal();
                } catch {
                    closeRestartModal();
                }
            });
        }
        if (elements.restartModalOverlay) {
            elements.restartModalOverlay.addEventListener('click', (e) => {
                if (e.target === elements.restartModalOverlay) closeRestartModal();
            });
        }

        if (elements.settingsCancel) elements.settingsCancel.addEventListener('click', closeSettings);
        if (elements.settingsResetCurrentTab) elements.settingsResetCurrentTab.addEventListener('click', () => resetCurrentSettingsTab?.());
        if (elements.settingsOk) {
            elements.settingsOk.addEventListener('click', async () => {
                try {
                    const activeTab = getActiveSettingsTabName?.() || 'playback';
                    const shouldPromptLanguageRestart = window.hasPendingLanguageChange?.() === true;
                    await applySettings?.();
                    if (shouldPromptLanguageRestart) {
                        window.showRestartHint?.();
                        window.openRestartModal?.();
                        return;
                    }
                    window.hideRestartHint?.();
                    window.safeNotify?.(
                        window.uiT?.(
                            'settings.notify.savedNamed',
                            '{tab} ayarları kaydedildi.',
                            { tab: getSettingsTabLabel?.(activeTab) || activeTab }
                        ) || 'Ayarlar kaydedildi.',
                        'success',
                        1800
                    );
                } catch (error) {
                    console.error('[SETTINGS] save failed:', error);
                }
            });
        }

        if (elements.settingsTabs?.length) {
            elements.settingsTabs.forEach((tab) => {
                tab.addEventListener('click', () => deps.switchSettingsTab(tab));
            });
        }

        if (elements.resetPlayback) elements.resetPlayback.addEventListener('click', resetPlaybackDefaults);
        if (elements.resetListen) elements.resetListen.addEventListener('click', resetListenDefaults);
        if (elements.pulseQuickMode) elements.pulseQuickMode.addEventListener('change', updatePulseQuickModeUi);
        if (elements.pulseQuickModeCards?.length) {
            elements.pulseQuickModeCards.forEach((card) => {
                card.addEventListener('click', () => {
                    const mode = String(card.dataset.pulseQuickMode || '').trim().toLowerCase();
                    if (!elements.pulseQuickMode || !['normal', 'background', 'max'].includes(mode)) return;
                    elements.pulseQuickMode.value = mode;
                    updatePulseQuickModeUi();
                });
            });
        }
        if (elements.audioDefaultVolume) {
            elements.audioDefaultVolume.addEventListener('input', () => {
                window.AurivoSettingsShared?.updateAudioSettingsVolumeLabel?.(elements);
            });
        }
        if (elements.audioAppVolume) {
            elements.audioAppVolume.addEventListener('input', () => {
                window.AurivoSettingsShared?.updateAudioAppVolumeLabel?.(elements);
            });
        }
        if (elements.libraryClearVideoLibrary) {
            elements.libraryClearVideoLibrary.addEventListener('click', () => {
                deps.clearVideoLibrary?.();
            });
        }

        if (elements.adblockModeCards?.length) {
            elements.adblockModeCards.forEach((card) => {
                card.addEventListener('click', () => setAdblockMode(card.dataset.adblockMode));
            });
        }
        if (elements.adblockShowBlockedCount) {
            elements.adblockShowBlockedCount.addEventListener('change', () => {
                readAdblockSettingsFromUI();
                updateAdblockBadge(deps.getBlockedCount());
            });
        }
        if (elements.adblockAutoRefreshOnModeChange) {
            elements.adblockAutoRefreshOnModeChange.addEventListener('change', () => {
                readAdblockSettingsFromUI();
            });
        }
        if (elements.adblockOpenDashboardBtn) {
            elements.adblockOpenDashboardBtn.addEventListener('click', () => {
                openAdblockDashboardPanel?.();
            });
        }

        const crossfadeAuto = document.getElementById('crossfadeAuto');
        const sameAlbumNo = document.getElementById('sameAlbumNoCrossfade');
        if (crossfadeAuto && sameAlbumNo) {
            crossfadeAuto.addEventListener('change', () => {
                sameAlbumNo.disabled = !crossfadeAuto.checked;
            });
        }

        const restoreLastTrackOnStartup = document.getElementById('restoreLastTrackOnStartup');
        const autoplayLastTrackOnStartup = document.getElementById('autoplayLastTrackOnStartup');
        const resumePositionOnStartup = document.getElementById('resumePositionOnStartup');
        const syncStartupRestoreUi = () => {
            const enabled = !!restoreLastTrackOnStartup?.checked;
            if (autoplayLastTrackOnStartup) autoplayLastTrackOnStartup.disabled = !enabled;
            if (resumePositionOnStartup) resumePositionOnStartup.disabled = !enabled;
        };
        if (restoreLastTrackOnStartup) {
            restoreLastTrackOnStartup.addEventListener('change', syncStartupRestoreUi);
            syncStartupRestoreUi();
        }

        const endWarningEnabled = document.getElementById('endWarningEnabled');
        const endWarningSeconds = document.getElementById('endWarningSeconds');
        const syncEndWarningUi = () => {
            if (endWarningSeconds) endWarningSeconds.disabled = !endWarningEnabled?.checked;
        };
        if (endWarningEnabled) {
            endWarningEnabled.addEventListener('change', syncEndWarningUi);
            syncEndWarningUi();
        }

        const smartVolumeLevelingEnabled = document.getElementById('smartVolumeLevelingEnabled');
        const smartVolumeLevelingMode = document.getElementById('smartVolumeLevelingMode');
        const syncSmartLevelingUi = () => {
            if (smartVolumeLevelingMode) smartVolumeLevelingMode.disabled = !smartVolumeLevelingEnabled?.checked;
        };
        if (smartVolumeLevelingEnabled) {
            smartVolumeLevelingEnabled.addEventListener('change', syncSmartLevelingUi);
            syncSmartLevelingUi();
        }

        document.addEventListener('keydown', handleKeyboard);
        setupSecurityUI();
        startAdblockStatsPolling();
    }

    window.AurivoSettingsWindow = {
        setupStandaloneEventListeners
    };
})();
