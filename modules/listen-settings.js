(function attachAurivoListenSettings() {
    function getPulseQuickModeLabel(mode, translate) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'max') {
            return translate('listen.quick.mode.options.max', 'Maksimum Dogruluk');
        }
        if (normalized === 'normal') {
            return translate('listen.quick.mode.options.normal', 'Normal Dinleme');
        }
        return translate('listen.quick.mode.options.background', 'Fon Müzik Odakli');
    }

    function getPulseQuickModeDetail(mode, translate) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'max') {
            return translate(
                'listen.quick.mode.detail.max',
                'Maksimum Dogruluk: Daha sik ornek alir ve daha uzun bekler. Cover, live, remix ve dusuk sesli fon muziklerde en guclu moddur.'
            );
        }
        if (normalized === 'normal') {
            return translate(
                'listen.quick.mode.detail.normal',
                'Normal Dinleme: Temiz muzik, resmi surumler ve gunluk hizli kullanim icin en dengeli mod.'
            );
        }
        return translate(
            'listen.quick.mode.detail.background',
            'Fon Muzik Odakli: Konusma, ortam sesi veya efektlerin arkasinda kalan muzikleri bulmak icin daha uygundur.'
        );
    }

    window.AurivoListenSettings = {
        getPulseQuickModeLabel,
        getPulseQuickModeDetail
    };
})();
