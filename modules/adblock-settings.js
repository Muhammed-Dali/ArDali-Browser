(function attachAurivoAdblockSettings() {
    function updateModeUI({ elements, adblock, normalizeMode }) {
        if (!elements) return;
        const mode = normalizeMode(adblock?.mode);

        if (elements.adblockModeCards?.length) {
            elements.adblockModeCards.forEach((card) => {
                const cardMode = normalizeMode(card.dataset.adblockMode);
                const active = cardMode === mode;
                card.classList.toggle('active', active);
                card.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }

        if (elements.adblockShowBlockedCount) {
            elements.adblockShowBlockedCount.checked = !!adblock?.showBlockedCount;
        }
        if (elements.adblockAutoRefreshOnModeChange) {
            elements.adblockAutoRefreshOnModeChange.checked = !!adblock?.autoRefreshOnModeChange;
        }
        if (elements.adblockStrictBlock) {
            elements.adblockStrictBlock.checked = !!adblock?.strictBlock;
        }
        if (elements.adblockDeveloperMode) {
            elements.adblockDeveloperMode.checked = !!adblock?.developerMode;
        }
    }

    function readSettingsFromUI({ elements, adblock }) {
        if (!elements || !adblock) return adblock;
        if (elements.adblockShowBlockedCount) {
            adblock.showBlockedCount = !!elements.adblockShowBlockedCount.checked;
        }
        if (elements.adblockAutoRefreshOnModeChange) {
            adblock.autoRefreshOnModeChange = !!elements.adblockAutoRefreshOnModeChange.checked;
        }
        if (elements.adblockStrictBlock) {
            adblock.strictBlock = !!elements.adblockStrictBlock.checked;
        }
        if (elements.adblockDeveloperMode) {
            adblock.developerMode = !!elements.adblockDeveloperMode.checked;
        }
        return adblock;
    }

    function updateBadge({ elements, blockedCount, showCount }) {
        const blocked = Number(blockedCount) || 0;
        if (elements?.adblockBlockedBadge) {
            if (!showCount || blocked <= 0) {
                elements.adblockBlockedBadge.classList.add('hidden');
                elements.adblockBlockedBadge.textContent = '0';
            } else {
                elements.adblockBlockedBadge.classList.remove('hidden');
                elements.adblockBlockedBadge.textContent = blocked > 99 ? '99+' : String(blocked);
            }
        }
        if (elements?.adblockStatusText) {
            elements.adblockStatusText.textContent = showCount
                ? `${blocked} reklam engellendi`
                : 'DeliBlock aktif';
        }
    }

    async function refreshStats({
        getStats,
        elements,
        updateBadge,
        setBlockedCount,
        notify,
        showToast = false
    }) {
        try {
            const stats = await getStats?.();
            if (!stats || typeof stats !== 'object') return;

            const blocked = Number(stats.blocked) || 0;
            const allowed = Number(stats.allowed) || 0;
            const total = Number(stats.totalRequests) || (blocked + allowed);
            const matcherStats = stats.matcher || {};

            if (elements?.adblockBlockedCount) elements.adblockBlockedCount.textContent = String(blocked);
            if (elements?.adblockTotalCount) elements.adblockTotalCount.textContent = String(total);
            if (elements?.adblockRulesetCount) {
                const loaded = Number(matcherStats.loadedRulesets);
                elements.adblockRulesetCount.textContent = Number.isFinite(loaded) ? String(loaded) : '-';
            }
            if (elements?.adblockDomainRuleCount) {
                const count = Number(matcherStats.blockDomains);
                elements.adblockDomainRuleCount.textContent = Number.isFinite(count) ? String(count) : '-';
            }

            updateBadge?.(blocked);
            setBlockedCount?.(blocked);

            if (showToast) notify?.(`DeliBlock: ${blocked} engelleme, ${total} toplam istek`, 'info', 1800);
        } catch (e) {
            if (showToast) notify?.('DeliBlock istatistikleri okunamadı', 'error', 1800);
            console.warn('[ADBLOCK] refreshStats error:', e?.message || e);
        }
    }

    window.AurivoAdblockSettings = {
        updateModeUI,
        readSettingsFromUI,
        updateBadge,
        refreshStats
    };
})();
