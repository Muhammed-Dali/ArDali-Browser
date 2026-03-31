const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');

const VISUALIZER_NATIVE_BASE = {
  'visualizerNative.context.display': 'Display',
  'visualizerNative.context.rendering': 'Rendering',
  'visualizerNative.context.presets': 'Presets',
  'visualizerNative.context.toggleFullscreen': 'Toggle fullscreen',
  'visualizerNative.context.frameRate': 'Frame rate',
  'visualizerNative.context.quality': 'Quality',
  'visualizerNative.context.clarity': 'Clarity',
  'visualizerNative.context.selectVisuals': 'Select visualizations...',
  'visualizerNative.context.close': 'Close visualization',
  'visualizerNative.context.fpsLow': 'Low (15 fps)',
  'visualizerNative.context.fpsMedium': 'Medium (25 fps)',
  'visualizerNative.context.fpsHigh': 'High (35 fps)',
  'visualizerNative.context.fpsUltra': 'Super high (60 fps)',
  'visualizerNative.context.qualityLow': 'Low (256x256)',
  'visualizerNative.context.qualityMedium': 'Medium (512x512)',
  'visualizerNative.context.qualityHigh': 'High (1024x1024)',
  'visualizerNative.context.qualityUltra': 'Super high (2048x2048)',
  'visualizerNative.context.claritySoft': 'Soft',
  'visualizerNative.context.clarityBalanced': 'Balanced',
  'visualizerNative.context.claritySharp': 'Sharp',
  'visualizerNative.context.claritySharpPlus': 'Sharp+',
  'visualizerNative.picker.title': 'Aurivo Visuals',
  'visualizerNative.picker.heroTitle': 'Curate the visual atmosphere',
  'visualizerNative.picker.heroHint': 'Choose presets included in auto-switch flow with a cleaner layout.',
  'visualizerNative.picker.presetDirectory': 'Preset directory',
  'visualizerNative.picker.search': 'Search presets...',
  'visualizerNative.picker.delay': 'Switch delay',
  'visualizerNative.picker.enabled': 'Enabled',
  'visualizerNative.picker.compact': 'Compact',
  'visualizerNative.picker.filterActive': 'Filter active:',
  'visualizerNative.picker.gallery': 'Preset gallery',
  'visualizerNative.picker.noMatch': 'No preset matched your search.',
  'visualizerNative.picker.inRotation': 'In rotation',
  'visualizerNative.picker.manualOnly': 'Manual only',
  'visualizerNative.picker.includedInAutoSwitch': 'Included in auto-switch',
  'visualizerNative.picker.selectAll': 'Select all',
  'visualizerNative.picker.clearAll': 'Clear all',
  'visualizerNative.picker.done': 'Done'
};

const OVERRIDES = {
  'tr-TR': {
    'visualizerNative.context.display': 'Görünüm',
    'visualizerNative.context.rendering': 'İşleme',
    'visualizerNative.context.presets': 'Presetler',
    'visualizerNative.context.toggleFullscreen': 'Tam ekran göster/gizle',
    'visualizerNative.context.frameRate': 'Kare oranı',
    'visualizerNative.context.quality': 'Kalite',
    'visualizerNative.context.clarity': 'Netlik',
    'visualizerNative.context.selectVisuals': 'Görselleştirmeleri seç...',
    'visualizerNative.context.close': 'Görselleştirmeyi kapat',
    'visualizerNative.context.fpsLow': 'Düşük (15 fps)',
    'visualizerNative.context.fpsMedium': 'Orta (25 fps)',
    'visualizerNative.context.fpsHigh': 'Yüksek (35 fps)',
    'visualizerNative.context.fpsUltra': 'Süper yüksek (60 fps)',
    'visualizerNative.context.qualityLow': 'Düşük (256x256)',
    'visualizerNative.context.qualityMedium': 'Orta (512x512)',
    'visualizerNative.context.qualityHigh': 'Yüksek (1024x1024)',
    'visualizerNative.context.qualityUltra': 'Süper yüksek (2048x2048)',
    'visualizerNative.context.claritySoft': 'Yumuşak',
    'visualizerNative.context.clarityBalanced': 'Dengeli',
    'visualizerNative.context.claritySharp': 'Keskin',
    'visualizerNative.context.claritySharpPlus': 'Keskin+',
    'visualizerNative.picker.title': 'Aurivo Görseller',
    'visualizerNative.picker.heroTitle': 'Görsel atmosferi seçin',
    'visualizerNative.picker.heroHint': 'Otomatik geçişe dahil olacak presetleri düzenli bir akışta yönetin.',
    'visualizerNative.picker.presetDirectory': 'Preset dizini',
    'visualizerNative.picker.search': 'Preset ara...',
    'visualizerNative.picker.delay': 'Geçiş gecikmesi',
    'visualizerNative.picker.enabled': 'Etkin',
    'visualizerNative.picker.compact': 'Kompakt',
    'visualizerNative.picker.filterActive': 'Filtre aktif:',
    'visualizerNative.picker.gallery': 'Preset galerisi',
    'visualizerNative.picker.noMatch': 'Aramanızla eşleşen preset bulunamadı.',
    'visualizerNative.picker.inRotation': 'Döngüde',
    'visualizerNative.picker.manualOnly': 'Sadece manuel',
    'visualizerNative.picker.includedInAutoSwitch': 'Otomatik geçişe dahil',
    'visualizerNative.picker.selectAll': 'Tümünü seç',
    'visualizerNative.picker.clearAll': 'Tümünü temizle',
    'visualizerNative.picker.done': 'Tamam'
  },
  'ar-SA': {
    'visualizerNative.context.display': 'العرض',
    'visualizerNative.context.rendering': 'التصيير',
    'visualizerNative.context.presets': 'الإعدادات المسبقة',
    'visualizerNative.context.toggleFullscreen': 'تبديل ملء الشاشة',
    'visualizerNative.context.frameRate': 'معدل الإطارات',
    'visualizerNative.context.quality': 'الجودة',
    'visualizerNative.context.clarity': 'الوضوح',
    'visualizerNative.context.selectVisuals': 'اختيار المرئيات...',
    'visualizerNative.context.close': 'إغلاق المرئيات',
    'visualizerNative.context.fpsLow': 'منخفض (15 إطار/ث)',
    'visualizerNative.context.fpsMedium': 'متوسط (25 إطار/ث)',
    'visualizerNative.context.fpsHigh': 'مرتفع (35 إطار/ث)',
    'visualizerNative.context.fpsUltra': 'مرتفع جدًا (60 إطار/ث)',
    'visualizerNative.context.qualityLow': 'منخفض (256x256)',
    'visualizerNative.context.qualityMedium': 'متوسط (512x512)',
    'visualizerNative.context.qualityHigh': 'مرتفع (1024x1024)',
    'visualizerNative.context.qualityUltra': 'مرتفع جدًا (2048x2048)',
    'visualizerNative.context.claritySoft': 'ناعم',
    'visualizerNative.context.clarityBalanced': 'متوازن',
    'visualizerNative.context.claritySharp': 'حاد',
    'visualizerNative.context.claritySharpPlus': 'حاد+',
    'visualizerNative.picker.title': 'مرئيات Aurivo',
    'visualizerNative.picker.heroTitle': 'نسّق الأجواء البصرية',
    'visualizerNative.picker.heroHint': 'اختر الإعدادات المسبقة ضمن تدفق تبديل تلقائي منظم.',
    'visualizerNative.picker.presetDirectory': 'مجلد الإعدادات المسبقة',
    'visualizerNative.picker.search': 'ابحث عن preset...',
    'visualizerNative.picker.delay': 'تأخير التبديل',
    'visualizerNative.picker.enabled': 'مفعّل',
    'visualizerNative.picker.compact': 'مضغوط',
    'visualizerNative.picker.filterActive': 'الفلتر نشط:',
    'visualizerNative.picker.gallery': 'معرض الإعدادات',
    'visualizerNative.picker.noMatch': 'لم يتم العثور على preset مطابق.',
    'visualizerNative.picker.inRotation': 'ضمن التدوير',
    'visualizerNative.picker.manualOnly': 'يدوي فقط',
    'visualizerNative.picker.includedInAutoSwitch': 'مضمن في التبديل التلقائي',
    'visualizerNative.picker.selectAll': 'تحديد الكل',
    'visualizerNative.picker.clearAll': 'مسح الكل',
    'visualizerNative.picker.done': 'تم'
  },
  'de-DE': {
    'visualizerNative.context.display': 'Anzeige',
    'visualizerNative.context.rendering': 'Rendering',
    'visualizerNative.context.presets': 'Presets',
    'visualizerNative.context.toggleFullscreen': 'Vollbild umschalten',
    'visualizerNative.context.frameRate': 'Bildrate',
    'visualizerNative.context.quality': 'Qualität',
    'visualizerNative.context.clarity': 'Schärfe',
    'visualizerNative.context.selectVisuals': 'Visuals auswählen...',
    'visualizerNative.context.close': 'Visualizer schließen',
    'visualizerNative.context.fpsLow': 'Niedrig (15 fps)',
    'visualizerNative.context.fpsMedium': 'Mittel (25 fps)',
    'visualizerNative.context.fpsHigh': 'Hoch (35 fps)',
    'visualizerNative.context.fpsUltra': 'Sehr hoch (60 fps)',
    'visualizerNative.context.qualityLow': 'Niedrig (256x256)',
    'visualizerNative.context.qualityMedium': 'Mittel (512x512)',
    'visualizerNative.context.qualityHigh': 'Hoch (1024x1024)',
    'visualizerNative.context.qualityUltra': 'Sehr hoch (2048x2048)',
    'visualizerNative.context.claritySoft': 'Weich',
    'visualizerNative.context.clarityBalanced': 'Ausgewogen',
    'visualizerNative.context.claritySharp': 'Scharf',
    'visualizerNative.context.claritySharpPlus': 'Scharf+',
    'visualizerNative.picker.title': 'Aurivo Visuals',
    'visualizerNative.picker.heroTitle': 'Visuelle Atmosphäre kuratieren',
    'visualizerNative.picker.heroHint': 'Wähle Presets für den automatischen Wechsel in einer klaren Ansicht.',
    'visualizerNative.picker.presetDirectory': 'Preset-Ordner',
    'visualizerNative.picker.search': 'Preset suchen...',
    'visualizerNative.picker.delay': 'Wechselverzögerung',
    'visualizerNative.picker.enabled': 'Aktiv',
    'visualizerNative.picker.compact': 'Kompakt',
    'visualizerNative.picker.filterActive': 'Filter aktiv:',
    'visualizerNative.picker.gallery': 'Preset-Galerie',
    'visualizerNative.picker.noMatch': 'Kein passendes Preset gefunden.',
    'visualizerNative.picker.inRotation': 'In Rotation',
    'visualizerNative.picker.manualOnly': 'Nur manuell',
    'visualizerNative.picker.includedInAutoSwitch': 'Im Auto-Wechsel enthalten',
    'visualizerNative.picker.selectAll': 'Alle auswählen',
    'visualizerNative.picker.clearAll': 'Alle löschen',
    'visualizerNative.picker.done': 'Fertig'
  },
  'fr-FR': {
    'visualizerNative.context.display': 'Affichage',
    'visualizerNative.context.rendering': 'Rendu',
    'visualizerNative.context.presets': 'Presets',
    'visualizerNative.context.toggleFullscreen': 'Basculer plein écran',
    'visualizerNative.context.frameRate': 'Fréquence d’images',
    'visualizerNative.context.quality': 'Qualité',
    'visualizerNative.context.clarity': 'Netteté',
    'visualizerNative.context.selectVisuals': 'Sélectionner des visuels...',
    'visualizerNative.context.close': 'Fermer le visualiseur',
    'visualizerNative.context.fpsLow': 'Faible (15 fps)',
    'visualizerNative.context.fpsMedium': 'Moyen (25 fps)',
    'visualizerNative.context.fpsHigh': 'Élevé (35 fps)',
    'visualizerNative.context.fpsUltra': 'Très élevé (60 fps)',
    'visualizerNative.context.qualityLow': 'Faible (256x256)',
    'visualizerNative.context.qualityMedium': 'Moyen (512x512)',
    'visualizerNative.context.qualityHigh': 'Élevé (1024x1024)',
    'visualizerNative.context.qualityUltra': 'Très élevé (2048x2048)',
    'visualizerNative.context.claritySoft': 'Doux',
    'visualizerNative.context.clarityBalanced': 'Équilibré',
    'visualizerNative.context.claritySharp': 'Net',
    'visualizerNative.context.claritySharpPlus': 'Net+',
    'visualizerNative.picker.title': 'Visuels Aurivo',
    'visualizerNative.picker.heroTitle': 'Composez l’atmosphère visuelle',
    'visualizerNative.picker.heroHint': 'Choisissez les presets inclus dans la rotation auto avec une vue claire.',
    'visualizerNative.picker.presetDirectory': 'Dossier des presets',
    'visualizerNative.picker.search': 'Rechercher un preset...',
    'visualizerNative.picker.delay': 'Délai de rotation',
    'visualizerNative.picker.enabled': 'Actif',
    'visualizerNative.picker.compact': 'Compact',
    'visualizerNative.picker.filterActive': 'Filtre actif :',
    'visualizerNative.picker.gallery': 'Galerie de presets',
    'visualizerNative.picker.noMatch': 'Aucun preset ne correspond.',
    'visualizerNative.picker.inRotation': 'Dans la rotation',
    'visualizerNative.picker.manualOnly': 'Manuel uniquement',
    'visualizerNative.picker.includedInAutoSwitch': 'Inclus dans la rotation auto',
    'visualizerNative.picker.selectAll': 'Tout sélectionner',
    'visualizerNative.picker.clearAll': 'Tout effacer',
    'visualizerNative.picker.done': 'Terminer'
  },
  'es-ES': {
    'visualizerNative.context.display': 'Pantalla',
    'visualizerNative.context.rendering': 'Renderizado',
    'visualizerNative.context.presets': 'Presets',
    'visualizerNative.context.toggleFullscreen': 'Alternar pantalla completa',
    'visualizerNative.context.frameRate': 'Velocidad de fotogramas',
    'visualizerNative.context.quality': 'Calidad',
    'visualizerNative.context.clarity': 'Nitidez',
    'visualizerNative.context.selectVisuals': 'Seleccionar visuales...',
    'visualizerNative.context.close': 'Cerrar visualizador',
    'visualizerNative.context.fpsLow': 'Bajo (15 fps)',
    'visualizerNative.context.fpsMedium': 'Medio (25 fps)',
    'visualizerNative.context.fpsHigh': 'Alto (35 fps)',
    'visualizerNative.context.fpsUltra': 'Muy alto (60 fps)',
    'visualizerNative.context.qualityLow': 'Bajo (256x256)',
    'visualizerNative.context.qualityMedium': 'Medio (512x512)',
    'visualizerNative.context.qualityHigh': 'Alto (1024x1024)',
    'visualizerNative.context.qualityUltra': 'Muy alto (2048x2048)',
    'visualizerNative.context.claritySoft': 'Suave',
    'visualizerNative.context.clarityBalanced': 'Equilibrado',
    'visualizerNative.context.claritySharp': 'Nítido',
    'visualizerNative.context.claritySharpPlus': 'Nítido+',
    'visualizerNative.picker.title': 'Visuales de Aurivo',
    'visualizerNative.picker.heroTitle': 'Cura la atmósfera visual',
    'visualizerNative.picker.heroHint': 'Elige presets incluidos en el cambio automático con un diseño más limpio.',
    'visualizerNative.picker.presetDirectory': 'Carpeta de presets',
    'visualizerNative.picker.search': 'Buscar preset...',
    'visualizerNative.picker.delay': 'Retraso de cambio',
    'visualizerNative.picker.enabled': 'Activo',
    'visualizerNative.picker.compact': 'Compacto',
    'visualizerNative.picker.filterActive': 'Filtro activo:',
    'visualizerNative.picker.gallery': 'Galería de presets',
    'visualizerNative.picker.noMatch': 'No hay coincidencias.',
    'visualizerNative.picker.inRotation': 'En rotación',
    'visualizerNative.picker.manualOnly': 'Solo manual',
    'visualizerNative.picker.includedInAutoSwitch': 'Incluido en auto-cambio',
    'visualizerNative.picker.selectAll': 'Seleccionar todo',
    'visualizerNative.picker.clearAll': 'Limpiar todo',
    'visualizerNative.picker.done': 'Listo'
  },
  'hi-IN': {
    'visualizerNative.context.display': 'डिस्प्ले',
    'visualizerNative.context.rendering': 'रेंडरिंग',
    'visualizerNative.context.presets': 'प्रीसेट',
    'visualizerNative.context.toggleFullscreen': 'फुलस्क्रीन टॉगल करें',
    'visualizerNative.context.frameRate': 'फ्रेम दर',
    'visualizerNative.context.quality': 'गुणवत्ता',
    'visualizerNative.context.clarity': 'स्पष्टता',
    'visualizerNative.context.selectVisuals': 'विज़ुअल चुनें...',
    'visualizerNative.context.close': 'विज़ुअलाइज़र बंद करें',
    'visualizerNative.context.fpsLow': 'कम (15 fps)',
    'visualizerNative.context.fpsMedium': 'मध्यम (25 fps)',
    'visualizerNative.context.fpsHigh': 'उच्च (35 fps)',
    'visualizerNative.context.fpsUltra': 'बहुत उच्च (60 fps)',
    'visualizerNative.context.qualityLow': 'कम (256x256)',
    'visualizerNative.context.qualityMedium': 'मध्यम (512x512)',
    'visualizerNative.context.qualityHigh': 'उच्च (1024x1024)',
    'visualizerNative.context.qualityUltra': 'बहुत उच्च (2048x2048)',
    'visualizerNative.context.claritySoft': 'नरम',
    'visualizerNative.context.clarityBalanced': 'संतुलित',
    'visualizerNative.context.claritySharp': 'तीक्ष्ण',
    'visualizerNative.context.claritySharpPlus': 'तीक्ष्ण+',
    'visualizerNative.picker.title': 'Aurivo विज़ुअल्स',
    'visualizerNative.picker.heroTitle': 'विज़ुअल माहौल चुनें',
    'visualizerNative.picker.heroHint': 'ऑटो-स्विच फ्लो में शामिल प्रीसेट साफ लेआउट में चुनें।',
    'visualizerNative.picker.presetDirectory': 'प्रीसेट फ़ोल्डर',
    'visualizerNative.picker.search': 'प्रीसेट खोजें...',
    'visualizerNative.picker.delay': 'स्विच देरी',
    'visualizerNative.picker.enabled': 'सक्रिय',
    'visualizerNative.picker.compact': 'कॉम्पैक्ट',
    'visualizerNative.picker.filterActive': 'फ़िल्टर सक्रिय:',
    'visualizerNative.picker.gallery': 'प्रीसेट गैलरी',
    'visualizerNative.picker.noMatch': 'आपकी खोज से कोई प्रीसेट मेल नहीं खाया।',
    'visualizerNative.picker.inRotation': 'रोटेशन में',
    'visualizerNative.picker.manualOnly': 'केवल मैनुअल',
    'visualizerNative.picker.includedInAutoSwitch': 'ऑटो-स्विच में शामिल',
    'visualizerNative.picker.selectAll': 'सभी चुनें',
    'visualizerNative.picker.clearAll': 'सभी साफ करें',
    'visualizerNative.picker.done': 'पूरा'
  }
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main() {
  const localeFiles = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json')).sort();
  let updated = 0;
  let keyWrites = 0;

  for (const fileName of localeFiles) {
    const locale = fileName.replace(/\.json$/i, '');
    const filePath = path.join(LOCALES_DIR, fileName);
    const json = readJson(filePath);
    const overrides = OVERRIDES[locale] || {};
    let touched = false;

    for (const [key, enValue] of Object.entries(VISUALIZER_NATIVE_BASE)) {
      const cur = json[key];
      const next = (typeof overrides[key] === 'string' && overrides[key].trim())
        ? overrides[key]
        : (typeof cur === 'string' && cur.trim())
          ? cur
          : enValue;

      if (json[key] !== next) {
        json[key] = next;
        touched = true;
        keyWrites += 1;
      }
    }

    if (touched) {
      writeJson(filePath, json);
      updated += 1;
    }
  }

  console.log(`Visualizer locale sync complete. Updated files: ${updated}, updated keys: ${keyWrites}`);
}

main();
