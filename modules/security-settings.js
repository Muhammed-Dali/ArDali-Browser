(function attachArDaliSecuritySettings() {
    function isVisible({ settingsPage }) {
        const securitySettings = document.getElementById('securitySettings');
        return Boolean(
            securitySettings &&
            !securitySettings.classList.contains('hidden') &&
            settingsPage &&
            !settingsPage.classList.contains('hidden')
        );
    }

    async function updateUI({
        elements,
        getUrl,
        parseHttpUrl,
        getSecurityState,
        translate,
        strictVpnBlock,
        enforceAllowlist
    }) {
        const url = getUrl();
        const isHttps = url.startsWith('https://');
        const isHttp = url.startsWith('http://');
        const canOpenExternal = !!parseHttpUrl(url);
        const sec = await getSecurityState();

        if (elements.securityCurrentUrl) {
            elements.securityCurrentUrl.textContent = translate('securityPage.dynamic.urlLine', 'URL: {url}', { url });
        }
        if (elements.securityConnStatus) {
            if (isHttps) elements.securityConnStatus.textContent = translate('securityPage.dynamic.connSecure', 'Connection: Secure (HTTPS)');
            else if (isHttp) elements.securityConnStatus.textContent = translate('securityPage.dynamic.connInsecure', 'Connection: Insecure (HTTP)');
            else elements.securityConnStatus.textContent = translate('securityPage.dynamic.connUnknown', 'Connection: -');
        }

        if (elements.securityAllowPopups && elements.webView) {
            elements.securityAllowPopups.checked = elements.webView.hasAttribute('allowpopups');
        }
        if (elements.securityStrictVpnBlock) {
            elements.securityStrictVpnBlock.checked = !!strictVpnBlock;
        }
        if (elements.securityEnforceAllowlist) {
            elements.securityEnforceAllowlist.checked = !!enforceAllowlist;
        }

        const vpnEl = document.getElementById('securityVpnStatus');
        if (vpnEl) {
            if (sec.vpnDetected) {
                const list = (sec.vpnInterfaces || []).join(', ');
                vpnEl.textContent = translate('securityPage.dynamic.vpnDetected', 'VPN: Algılandı ({interfaces})', { interfaces: list || '-' });
            } else {
                vpnEl.textContent = translate('securityPage.dynamic.vpnNotDetected', 'VPN: Algılanmadı');
            }
        }

        if (elements.securityOpenInBrowserBtn) {
            elements.securityOpenInBrowserBtn.disabled = !canOpenExternal;
            elements.securityOpenInBrowserBtn.style.opacity = canOpenExternal ? '1' : '0.55';
            elements.securityOpenInBrowserBtn.style.cursor = canOpenExternal ? 'pointer' : 'not-allowed';
        }
    }

    window.ArDaliSecuritySettings = {
        isVisible,
        updateUI
    };
})();
