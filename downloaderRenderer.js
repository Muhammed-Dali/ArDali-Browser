const api = window.aurivo?.downloader;
const electronApi = window.aurivo?.electronAPI;

const DOWNLOADER_LOCALES = {
    'en-US': {
        'common.auto': 'Automatic',
        'common.cancelled': 'Cancelled',
        'common.close': 'Close',
        'common.copy': 'Copy',
        'common.end': 'End',
        'common.error': 'Error',
        'common.loading': 'Loading',
        'common.maximize': 'Maximize',
        'common.menu': 'Menu',
        'common.minimize': 'Minimize',
        'common.none': 'None',
        'common.ready': 'Ready',
        'common.start': 'Start',
        'common.unknownError': 'Unknown error',
        'action.analyze': 'Analyze',
        'action.cancel': 'Cancel',
        'action.chooseDownloadDir': 'Choose download folder',
        'action.chooseFolder': 'Choose folder',
        'action.clear': 'Clear',
        'action.compress': 'Compress',
        'action.download': 'Download',
        'action.extract': 'Extract',
        'action.moreSettings': 'More settings',
        'action.paste': 'Paste',
        'action.refresh': 'Refresh',
        'advanced.closeOnFinish': 'Close window when download finishes',
        'advanced.currentDownloadDir': 'Current download folder',
        'advanced.customArgs': 'Custom yt-dlp arguments',
        'advanced.subtitles': 'Download subtitles if available',
        'advanced.timeRange': 'Download a specific time range',
        'brand.source': 'Source',
        'compressor.dropHint': 'or choose videos from your computer',
        'compressor.dropTitle': 'Drop files here',
        'compressor.encoder': 'Video encoder',
        'compressor.emptyFiles': 'No files selected yet.',
        'compressor.outputFolder': 'Output folder',
        'compressor.outputFormat': 'Output format',
        'compressor.sameFolder': 'Save to the same folder',
        'compressor.sameFolderUsed': 'The same folder will be used',
        'compressor.selectOutputFolder': 'No output folder selected',
        'compressor.selectedFiles': 'Selected files',
        'compressor.speed': 'Compression speed',
        'compressor.starting': 'Starting compression',
        'compressor.startingDetail': 'Preparing ffmpeg task',
        'compressor.started': 'Compressor is running',
        'compressor.startedDetail': 'You can follow the progress from the list below',
        'compressor.subtitle': 'Make video files smaller with ffmpeg.',
        'compressor.suffix': 'Output suffix',
        'compressor.title': 'Compressor',
        'compressor.unchanged': 'Keep unchanged',
        'compressor.videoQuality': 'Video quality',
        'dependency.missing': 'Missing',
        'dependency.prepareFailed': 'Tools could not be prepared',
        'dependency.progress': 'Progress {percent}',
        'dependency.ready': 'Ready',
        'dependency.wait': 'Please wait files are downloading',
        'downloader.brand.subtitle': 'Video and audio download center',
        'error.analysisFailed': 'Analysis failed',
        'error.apiMissing': 'Downloader API could not be loaded.',
        'error.bridgeMissing': 'Bridge could not be loaded',
        'error.details': 'Error details',
        'error.fileRequired': 'File required',
        'error.fileRequiredDetail': 'Select at least one video file to compress.',
        'error.noUrl.detail': 'URL link not found\nOpen a video or song page first then press the download button again',
        'error.noUrl.title': 'An error occurred Check your internet and use a valid link',
        'error.outputRequired': 'Output folder required',
        'error.outputRequiredDetail': 'Choose an output folder when save to same folder is off.',
        'error.videoInfoFailed': 'Could not get video information.',
        'extract.quality': 'Choose quality',
        'extract.title': 'Extract audio',
        'hero.subtitle': 'A cleaner faster download experience that feels yours.',
        'hero.tagline': 'Download smarter with Aurivo-Dawlod.',
        'history.allFormats': 'All formats',
        'history.allStatuses': 'All statuses',
        'history.cancelled': 'Cancelled',
        'history.clearAll': 'Clear all history',
        'history.completed': 'Completed',
        'history.empty': 'No history records.',
        'history.errors': 'Errors',
        'history.exported': 'History exported',
        'history.extractedAudio': 'Extracted audio',
        'history.issue': 'Error / Cancel',
        'history.search': 'Search title or URL',
        'history.show': 'Show',
        'history.successful': 'Successful',
        'history.title': 'Download History',
        'history.total': 'Total downloads',
        'jobs.clearCompleted': 'Clear completed',
        'jobs.folderShow': 'Show in folder',
        'jobs.formatBack': 'Back to format settings',
        'jobs.title': 'Downloading',
        'menu.about': 'About',
        'menu.aria': 'Aurivo Dawlod menu',
        'menu.compressor': 'Compressor',
        'menu.history': 'Download History',
        'menu.playlist': 'Download playlist',
        'menu.settings': 'Settings',
        'menu.theme': 'Theme',
        'mode.audio': 'Audio',
        'mode.video': 'Video',
        'nav.history': 'History',
        'nav.playlist': 'Playlist',
        'nav.single': 'Single',
        'playlist.audioFormat': 'Audio format',
        'playlist.downloadThumbnails': 'Download covers',
        'playlist.fileTemplate': 'File template',
        'playlist.folderTemplate': 'Folder template',
        'playlist.link': 'Link',
        'playlist.paste': 'Paste playlist link',
        'playlist.range': 'Playlist range',
        'playlist.saveLinks': 'Save links',
        'playlist.saveLinksToFile': 'Save links to file',
        'playlist.thumbnails': 'Covers',
        'playlist.url.placeholder': 'Playlist URL',
        'playlist.videoFormat': 'Video format',
        'playlist.videoQuality': 'Video quality',
        'quality.best': 'Best',
        'quality.good': 'Good',
        'quality.low': 'Low',
        'quality.lowest': 'Lowest',
        'quality.normal': 'Normal',
        'settings.browserCookies': 'Choose the browser to use cookies from',
        'settings.chooseConfig': 'Choose config',
        'settings.closeToTray': 'Close to system tray',
        'settings.customOptions': 'Set custom yt-dlp options <a href="https://github.com/yt-dlp/yt-dlp#usage-and-options">Learn more</a>',
        'settings.dependencies': 'Required tools',
        'settings.disableAutoUpdates': 'Disable automatic updates',
        'settings.downloadDir': 'Download folder',
        'settings.home': 'Home',
        'settings.maxDownloads': 'Maximum active downloads',
        'settings.playlistFileTemplate': 'Playlist file name',
        'settings.playlistFolderTemplate': 'Playlist folder name',
        'settings.preferredAudioFormat': 'Preferred audio format',
        'settings.preferredVideoCodec': 'Preferred video codec',
        'settings.preferredVideoQuality': 'Preferred video quality',
        'settings.prepareDependencies': 'Prepare missing tools',
        'settings.resetFileTemplate': 'Reset file name to default',
        'settings.resetFolderTemplate': 'Reset folder name to default',
        'settings.restart': 'Restart application',
        'settings.showMoreFormats': 'Show more format settings',
        'settings.title': 'Settings',
        'settings.useConfig': 'Use configuration file',
        'single.analysisDone': 'Analysis completed',
        'single.analysisDoneDetail': 'Choose a format and start downloading.',
        'single.audioForVideo.select': 'Choose audio format',
        'single.format.select': 'Choose format',
        'single.noAudioFormat': 'No audio format found',
        'single.noVideoFormat': 'No video format found',
        'single.readyDetail': 'Paste a link and analyze it to start.',
        'single.sourceFallback': 'Source',
        'single.titleFallback': 'Title not found',
        'single.titleLabel': 'Title',
        'single.url.label': 'Link',
        'single.url.placeholder': 'YouTube Vimeo or another supported video link',
        'speed.fast': 'Fast',
        'speed.medium': 'Medium',
        'speed.slow': 'Slow',
        'status.aboutDetail': 'Video and audio download center.',
        'status.compressCancelled': 'Compression cancelled',
        'status.compressCancelledDetail': 'You can start a new task.',
        'status.compressorReady': 'Choose files and start compression.',
        'status.downloadPreparing': 'Preparing download',
        'status.downloadPreparingDetail': 'Preparing download task',
        'status.downloadStartFailed': 'Download could not be started',
        'status.extractPreparing': 'Extracting audio',
        'status.extractPreparingDetail': 'Preparing audio file',
        'status.extractFailed': 'Audio could not be extracted',
        'status.processing': 'Processing',
        'status.playlistDownloading': 'Playlist is downloading',
        'status.playlistDownloadingDetail': 'You can follow the progress from the downloads list.',
        'status.playlistFailed': 'Playlist could not be started',
        'status.playlistPreparing': 'Starting playlist',
        'status.playlistPreparingDetail': 'Preparing yt-dlp playlist task',
        'status.playlistUrlRequired': 'Playlist link required',
        'status.playlistUrlRequiredDetail': 'Enter a playlist link.',
        'status.urlRequired': 'Link required',
        'status.urlRequiredDetail': 'Enter a supported video link.',
        'theme.dark': 'Dark',
        'theme.light': 'Light'
    },
    'tr-TR': {
        'common.auto': 'Otomatik',
        'common.cancelled': 'İptal edildi',
        'common.close': 'Kapat',
        'common.copy': 'Kopyala',
        'common.end': 'Bitiş',
        'common.error': 'Hata',
        'common.loading': 'Yükleniyor',
        'common.maximize': 'Büyüt',
        'common.menu': 'Menü',
        'common.minimize': 'Küçült',
        'common.none': 'Hiçbiri',
        'common.ready': 'Hazır',
        'common.start': 'Başlangıç',
        'common.unknownError': 'Bilinmeyen hata',
        'action.analyze': 'Analiz Et',
        'action.cancel': 'İptal',
        'action.chooseDownloadDir': 'İndirme dizinini seç',
        'action.chooseFolder': 'Klasör seç',
        'action.clear': 'Temizle',
        'action.compress': 'Sıkıştır',
        'action.download': 'İndir',
        'action.extract': 'Çıkart',
        'action.moreSettings': 'Daha fazla ayar',
        'action.paste': 'Yapıştır',
        'action.refresh': 'Yenile',
        'advanced.closeOnFinish': 'İndirme bitince pencereyi kapat',
        'advanced.currentDownloadDir': 'Mevcut indirme dizini',
        'advanced.customArgs': 'Özel yt-dlp argümanları',
        'advanced.subtitles': 'Altyazılar varsa indir',
        'advanced.timeRange': 'Belirli zaman aralığını indir',
        'brand.source': 'Kaynak',
        'compressor.dropHint': 'veya bilgisayarından video seç',
        'compressor.dropTitle': 'Dosyaları buraya bırak',
        'compressor.encoder': 'Video kodlayıcı',
        'compressor.emptyFiles': 'Henüz dosya seçilmedi.',
        'compressor.outputFolder': 'Çıktı klasörü',
        'compressor.outputFormat': 'Çıktı formatı',
        'compressor.sameFolder': 'Aynı klasöre kaydet',
        'compressor.sameFolderUsed': 'Aynı klasör kullanılacak',
        'compressor.selectOutputFolder': 'Çıktı klasörü seçilmedi',
        'compressor.selectedFiles': 'Seçilen dosyalar',
        'compressor.speed': 'Sıkıştırma hızı',
        'compressor.starting': 'Sıkıştırma başlatılıyor',
        'compressor.startingDetail': 'ffmpeg görevi hazırlanıyor',
        'compressor.started': 'Sıkıştırıcı çalışıyor',
        'compressor.startedDetail': 'İlerlemeyi alttaki listeden takip edebilirsiniz',
        'compressor.subtitle': 'Video dosyalarını ffmpeg ile daha küçük hale getir.',
        'compressor.suffix': 'Çıktı eki',
        'compressor.title': 'Sıkıştırıcı',
        'compressor.unchanged': 'Aynı kalsın',
        'compressor.videoQuality': 'Video kalitesi',
        'dependency.missing': 'Eksik',
        'dependency.prepareFailed': 'Araçlar hazırlanamadı',
        'dependency.progress': 'Süreç {percent}',
        'dependency.ready': 'Hazır',
        'dependency.wait': 'Lütfen bekleyin dosyalar indiriliyor',
        'downloader.brand.subtitle': 'Video ve ses indirme merkezi',
        'error.analysisFailed': 'Analiz başarısız',
        'error.apiMissing': 'Downloader API bulunamadı.',
        'error.bridgeMissing': 'Köprü yüklenemedi',
        'error.details': 'Hata Ayrıntıları',
        'error.fileRequired': 'Dosya gerekli',
        'error.fileRequiredDetail': 'Sıkıştırmak için en az bir video dosyası seçin.',
        'error.noUrl.detail': 'URL bağlantısı bulunmadı\nÖnce video veya şarkı sayfasını açın sonra indir düğmesine tekrar basın',
        'error.noUrl.title': 'Hata oluştu İnternetinizi kontrol edin ve doğru bir bağlantı kullanın',
        'error.outputRequired': 'Çıktı klasörü gerekli',
        'error.outputRequiredDetail': 'Aynı klasöre kaydet kapalıyken bir çıktı klasörü seçin.',
        'error.videoInfoFailed': 'Video bilgisi alınamadı.',
        'extract.quality': 'Kalite seç',
        'extract.title': 'Sesi çıkart',
        'hero.subtitle': 'Daha temiz, daha hızlı, daha senin indirme deneyimin.',
        'hero.tagline': 'Aurivo-Dawlod ile daha akıllı indir.',
        'history.allFormats': 'Tüm formatlar',
        'history.allStatuses': 'Tüm durumlar',
        'history.cancelled': 'İptaller',
        'history.clearAll': 'Tüm geçmişi temizle',
        'history.completed': 'Tamamlananlar',
        'history.empty': 'Geçmiş kaydı yok.',
        'history.errors': 'Hatalar',
        'history.exported': 'Geçmiş dışa aktarıldı',
        'history.extractedAudio': 'Sesi çıkarılanlar',
        'history.issue': 'Hata / İptal',
        'history.search': 'Başlık veya URL ara',
        'history.show': 'Göster',
        'history.successful': 'Başarılı',
        'history.title': 'İndirme Geçmişi',
        'history.total': 'Toplam indirme',
        'jobs.clearCompleted': 'Tamamlananları temizle',
        'jobs.folderShow': 'Klasörde göster',
        'jobs.formatBack': 'Format ayarlarına dön',
        'jobs.title': 'İndiriliyor',
        'menu.about': 'Hakkında',
        'menu.aria': 'Aurivo Dawlod menüsü',
        'menu.compressor': 'Sıkıştırıcı',
        'menu.history': 'İndirme Geçmişi',
        'menu.playlist': 'Oynatma listesini indir',
        'menu.settings': 'Ayarlar',
        'menu.theme': 'Tema',
        'mode.audio': 'Ses',
        'mode.video': 'Video',
        'nav.history': 'Geçmiş',
        'nav.playlist': 'Playlist',
        'nav.single': 'Tekil',
        'playlist.audioFormat': 'Ses formatı',
        'playlist.downloadThumbnails': 'Kapakları indir',
        'playlist.fileTemplate': 'Dosya şablonu',
        'playlist.folderTemplate': 'Klasör şablonu',
        'playlist.link': 'Link',
        'playlist.paste': 'Oynatma listesi bağlantısını yapıştır',
        'playlist.range': 'Playlist aralığı',
        'playlist.saveLinks': 'Linkleri kaydet',
        'playlist.saveLinksToFile': 'Linkleri dosyaya kaydet',
        'playlist.thumbnails': 'Kapaklar',
        'playlist.url.placeholder': 'Playlist URL',
        'playlist.videoFormat': 'Video formatı',
        'playlist.videoQuality': 'Video kalitesi',
        'quality.best': 'En iyi',
        'quality.good': 'İyi',
        'quality.low': 'Düşük',
        'quality.lowest': 'En düşük',
        'quality.normal': 'Normal',
        'settings.browserCookies': 'Çerezlerin kullanılacağı tarayıcıyı seçin',
        'settings.chooseConfig': 'Config seç',
        'settings.closeToTray': 'Sistem tepsisine kapat',
        'settings.customOptions': 'Özel yt-dlp seçeneklerini ayarla <a href="https://github.com/yt-dlp/yt-dlp#usage-and-options">Daha fazla bilgi</a>',
        'settings.dependencies': 'Gerekli araçlar',
        'settings.disableAutoUpdates': 'Otomatik güncellemeleri devre dışı bırak',
        'settings.downloadDir': 'İndirme dizini',
        'settings.home': 'Ana sayfa',
        'settings.maxDownloads': 'Maksimum aktif indirme sayısı',
        'settings.playlistFileTemplate': 'Oynatma listesi için dosya adı',
        'settings.playlistFolderTemplate': 'Oynatma listesi için klasör ismi',
        'settings.preferredAudioFormat': 'Tercih edilen ses formatı',
        'settings.preferredVideoCodec': 'Tercih edilen video kodeği',
        'settings.preferredVideoQuality': 'Tercih edilen video kalitesi',
        'settings.prepareDependencies': 'Eksikleri hazırla',
        'settings.resetFileTemplate': 'Dosya adını varsayılana sıfırla',
        'settings.resetFolderTemplate': 'Klasör adını varsayılana sıfırla',
        'settings.restart': 'Uygulamayı yeniden başlat',
        'settings.showMoreFormats': 'Daha fazla format ayarı göster',
        'settings.title': 'Ayarlar',
        'settings.useConfig': 'Konfigürasyon dosyasını kullan',
        'single.analysisDone': 'Analiz tamamlandı',
        'single.analysisDoneDetail': 'Format seçip indirmeyi başlatabilirsiniz.',
        'single.audioForVideo.select': 'Ses formatını seçin',
        'single.format.select': 'Format seçin',
        'single.noAudioFormat': 'Ses formatı bulunamadı',
        'single.noVideoFormat': 'Video formatı bulunamadı',
        'single.readyDetail': 'Bir bağlantı yapıştırıp analiz ederek başlayın.',
        'single.sourceFallback': 'Kaynak',
        'single.titleFallback': 'Başlık bulunamadı',
        'single.titleLabel': 'Başlık',
        'single.url.label': 'Bağlantı',
        'single.url.placeholder': 'YouTube Vimeo veya desteklenen bir video bağlantısı',
        'speed.fast': 'Hızlı',
        'speed.medium': 'Orta',
        'speed.slow': 'Yavaş',
        'status.aboutDetail': 'Video ve ses indirme merkezi.',
        'status.compressCancelled': 'Sıkıştırma iptal edildi',
        'status.compressCancelledDetail': 'Yeni bir görev başlatabilirsiniz.',
        'status.compressorReady': 'Dosya seçip sıkıştırmayı başlatabilirsiniz.',
        'status.downloadPreparing': 'İndirme başlatılıyor',
        'status.downloadPreparingDetail': 'İndirme görevi hazırlanıyor',
        'status.downloadStartFailed': 'İndirme başlatılamadı',
        'status.extractPreparing': 'Ses çıkarılıyor',
        'status.extractPreparingDetail': 'Ses dosyası hazırlanıyor',
        'status.extractFailed': 'Ses çıkarılamadı',
        'status.processing': 'İşleniyor',
        'status.playlistDownloading': 'Playlist indiriliyor',
        'status.playlistDownloadingDetail': 'İlerlemeyi indirmeler listesinden takip edebilirsiniz.',
        'status.playlistFailed': 'Playlist başlatılamadı',
        'status.playlistPreparing': 'Playlist başlatılıyor',
        'status.playlistPreparingDetail': 'yt-dlp playlist görevi hazırlanıyor',
        'status.playlistUrlRequired': 'Playlist bağlantısı gerekli',
        'status.playlistUrlRequiredDetail': 'Lütfen bir playlist bağlantısı girin.',
        'status.urlRequired': 'Bağlantı gerekli',
        'status.urlRequiredDetail': 'Lütfen desteklenen bir video bağlantısı girin.',
        'theme.dark': 'Karanlık',
        'theme.light': 'Aydınlık'
    },
    'ar-SA': {}
};

Object.assign(DOWNLOADER_LOCALES['ar-SA'], DOWNLOADER_LOCALES['en-US'], {
    'common.auto': 'تلقائي',
    'common.cancelled': 'تم الإلغاء',
    'common.close': 'إغلاق',
    'common.copy': 'نسخ',
    'common.end': 'النهاية',
    'common.error': 'خطأ',
    'common.loading': 'جار التحميل',
    'common.maximize': 'تكبير',
    'common.menu': 'القائمة',
    'common.minimize': 'تصغير',
    'common.none': 'لا شيء',
    'common.ready': 'جاهز',
    'common.start': 'البداية',
    'common.unknownError': 'خطأ غير معروف',
    'action.analyze': 'تحليل',
    'action.cancel': 'إلغاء',
    'action.chooseDownloadDir': 'اختر مجلد التنزيل',
    'action.chooseFolder': 'اختر مجلدا',
    'action.clear': 'مسح',
    'action.compress': 'ضغط',
    'action.download': 'تنزيل',
    'action.extract': 'استخراج',
    'action.moreSettings': 'مزيد من الإعدادات',
    'action.paste': 'لصق',
    'action.refresh': 'تحديث',
    'advanced.closeOnFinish': 'أغلق النافذة بعد انتهاء التنزيل',
    'advanced.currentDownloadDir': 'مجلد التنزيل الحالي',
    'advanced.customArgs': 'وسائط yt-dlp مخصصة',
    'advanced.subtitles': 'تنزيل الترجمة إن وجدت',
    'advanced.timeRange': 'تنزيل نطاق زمني محدد',
    'compressor.dropHint': 'أو اختر فيديو من جهازك',
    'compressor.dropTitle': 'أفلت الملفات هنا',
    'compressor.encoder': 'برنامج ترميز الفيديو',
    'compressor.emptyFiles': 'لم يتم اختيار ملفات بعد.',
    'compressor.outputFormat': 'صيغة الإخراج',
    'compressor.outputFolder': 'مجلد الإخراج',
    'compressor.sameFolder': 'احفظ في المجلد نفسه',
    'compressor.sameFolderUsed': 'سيتم استخدام المجلد نفسه',
    'compressor.selectOutputFolder': 'لم يتم اختيار مجلد إخراج',
    'compressor.selectedFiles': 'الملفات المحددة',
    'compressor.speed': 'سرعة الضغط',
    'compressor.starting': 'بدء الضغط',
    'compressor.startingDetail': 'يتم تجهيز مهمة ffmpeg',
    'compressor.started': 'الضاغط يعمل',
    'compressor.startedDetail': 'يمكنك متابعة التقدم من القائمة بالأسفل',
    'compressor.subtitle': 'اجعل ملفات الفيديو أصغر باستخدام ffmpeg.',
    'compressor.suffix': 'لاحقة الإخراج',
    'compressor.title': 'الضاغط',
    'compressor.unchanged': 'ابقه كما هو',
    'compressor.videoQuality': 'جودة الفيديو',
    'dependency.missing': 'مفقود',
    'dependency.prepareFailed': 'تعذر تجهيز الأدوات',
    'dependency.progress': 'التقدم {percent}',
    'dependency.ready': 'جاهز',
    'dependency.wait': 'يرجى الانتظار يتم تنزيل الملفات',
    'downloader.brand.subtitle': 'مركز تنزيل الفيديو والصوت',
    'error.analysisFailed': 'فشل التحليل',
    'error.apiMissing': 'لم يتم العثور على واجهة التنزيل.',
    'error.bridgeMissing': 'تعذر تحميل الجسر',
    'error.details': 'تفاصيل الخطأ',
    'error.fileRequired': 'الملف مطلوب',
    'error.fileRequiredDetail': 'اختر ملف فيديو واحدا على الأقل للضغط.',
    'error.noUrl.detail': 'لم يتم العثور على رابط URL\nافتح صفحة فيديو أو أغنية أولا ثم اضغط زر التنزيل مرة أخرى',
    'error.noUrl.title': 'حدث خطأ تحقق من الإنترنت واستخدم رابطا صحيحا',
    'error.outputRequired': 'مجلد الإخراج مطلوب',
    'error.outputRequiredDetail': 'اختر مجلد إخراج عند إيقاف الحفظ في المجلد نفسه.',
    'extract.quality': 'اختر الجودة',
    'extract.title': 'استخراج الصوت',
    'hero.subtitle': 'تجربة تنزيل أنظف وأسرع ومناسبة لك.',
    'hero.tagline': 'نزّل بذكاء أكثر مع Aurivo-Dawlod.',
    'history.clearAll': 'مسح كل السجل',
    'history.completed': 'المكتملة',
    'history.empty': 'لا توجد سجلات.',
    'history.errors': 'الأخطاء',
    'history.exported': 'تم تصدير السجل',
    'history.issue': 'خطأ / إلغاء',
    'history.search': 'ابحث بالعنوان أو الرابط',
    'history.show': 'عرض',
    'history.successful': 'ناجح',
    'history.title': 'سجل التنزيلات',
    'history.total': 'إجمالي التنزيلات',
    'jobs.clearCompleted': 'مسح المكتمل',
    'jobs.folderShow': 'عرض في المجلد',
    'jobs.formatBack': 'العودة إلى إعدادات الصيغة',
    'jobs.title': 'جار التنزيل',
    'menu.about': 'حول',
    'menu.aria': 'قائمة Aurivo Dawlod',
    'menu.compressor': 'الضاغط',
    'menu.history': 'سجل التنزيلات',
    'menu.playlist': 'تنزيل قائمة تشغيل',
    'menu.settings': 'الإعدادات',
    'menu.theme': 'السمة',
    'mode.audio': 'صوت',
    'mode.video': 'فيديو',
    'nav.history': 'السجل',
    'nav.playlist': 'قائمة التشغيل',
    'nav.single': 'مفرد',
    'playlist.audioFormat': 'صيغة الصوت',
    'playlist.downloadThumbnails': 'تنزيل الصور المصغرة',
    'playlist.fileTemplate': 'قالب الملف',
    'playlist.folderTemplate': 'قالب المجلد',
    'playlist.link': 'الرابط',
    'playlist.paste': 'لصق رابط قائمة التشغيل',
    'playlist.range': 'نطاق قائمة التشغيل',
    'playlist.saveLinks': 'حفظ الروابط',
    'playlist.saveLinksToFile': 'حفظ الروابط في ملف',
    'playlist.thumbnails': 'الصور المصغرة',
    'playlist.url.placeholder': 'رابط قائمة التشغيل',
    'playlist.videoFormat': 'صيغة الفيديو',
    'playlist.videoQuality': 'جودة الفيديو',
    'quality.best': 'الأفضل',
    'quality.good': 'جيد',
    'quality.low': 'منخفض',
    'quality.lowest': 'الأدنى',
    'quality.normal': 'عادي',
    'settings.home': 'الصفحة الرئيسية',
    'settings.browserCookies': 'اختر المتصفح لاستخدام ملفات تعريف الارتباط منه',
    'settings.chooseConfig': 'اختر ملف الإعدادات',
    'settings.closeToTray': 'الإغلاق إلى علبة النظام',
    'settings.customOptions': 'اضبط خيارات yt-dlp مخصصة <a href="https://github.com/yt-dlp/yt-dlp#usage-and-options">معرفة المزيد</a>',
    'settings.dependencies': 'الأدوات المطلوبة',
    'settings.disableAutoUpdates': 'تعطيل التحديثات التلقائية',
    'settings.downloadDir': 'مجلد التنزيل',
    'settings.maxDownloads': 'الحد الأقصى للتنزيلات النشطة',
    'settings.playlistFileTemplate': 'اسم ملف قائمة التشغيل',
    'settings.playlistFolderTemplate': 'اسم مجلد قائمة التشغيل',
    'settings.preferredAudioFormat': 'صيغة الصوت المفضلة',
    'settings.preferredVideoCodec': 'ترميز الفيديو المفضل',
    'settings.preferredVideoQuality': 'جودة الفيديو المفضلة',
    'settings.prepareDependencies': 'جهز الأدوات الناقصة',
    'settings.resetFileTemplate': 'إعادة اسم الملف إلى الافتراضي',
    'settings.resetFolderTemplate': 'إعادة اسم المجلد إلى الافتراضي',
    'settings.restart': 'إعادة تشغيل التطبيق',
    'settings.showMoreFormats': 'إظهار المزيد من إعدادات الصيغ',
    'settings.title': 'الإعدادات',
    'settings.useConfig': 'استخدم ملف الإعدادات',
    'single.analysisDone': 'اكتمل التحليل',
    'single.analysisDoneDetail': 'اختر صيغة وابدأ التنزيل.',
    'single.noAudioFormat': 'لم يتم العثور على صيغة صوت',
    'single.noVideoFormat': 'لم يتم العثور على صيغة فيديو',
    'single.readyDetail': 'الصق رابطا وحلله للبدء.',
    'single.sourceFallback': 'المصدر',
    'single.titleFallback': 'لم يتم العثور على عنوان',
    'single.titleLabel': 'العنوان',
    'single.url.label': 'الرابط',
    'single.url.placeholder': 'رابط YouTube أو Vimeo أو فيديو مدعوم',
    'speed.fast': 'سريع',
    'speed.medium': 'متوسط',
    'speed.slow': 'بطيء',
    'status.aboutDetail': 'مركز تنزيل الفيديو والصوت.',
    'status.compressorReady': 'اختر الملفات وابدأ الضغط.',
    'status.downloadPreparing': 'بدء التنزيل',
    'status.downloadPreparingDetail': 'يتم تجهيز مهمة التنزيل',
    'status.downloadStartFailed': 'تعذر بدء التنزيل',
    'status.extractPreparing': 'استخراج الصوت',
    'status.extractPreparingDetail': 'يتم تجهيز ملف الصوت',
    'status.extractFailed': 'تعذر استخراج الصوت',
    'status.processing': 'جار المعالجة',
    'status.playlistDownloading': 'جار تنزيل قائمة التشغيل',
    'status.playlistDownloadingDetail': 'يمكنك متابعة التقدم من قائمة التنزيلات.',
    'status.playlistFailed': 'تعذر بدء قائمة التشغيل',
    'status.playlistPreparing': 'بدء قائمة التشغيل',
    'status.playlistPreparingDetail': 'يتم تجهيز مهمة قائمة التشغيل',
    'status.playlistUrlRequired': 'رابط قائمة التشغيل مطلوب',
    'status.playlistUrlRequiredDetail': 'أدخل رابط قائمة تشغيل.',
    'status.urlRequired': 'الرابط مطلوب',
    'status.urlRequiredDetail': 'أدخل رابط فيديو مدعوما.',
    'theme.dark': 'داكن',
    'theme.light': 'فاتح'
});

let currentDownloaderLang = 'en-US';

function normalizeDownloaderLang(lang) {
    const normalized = String(lang || '').trim().replace('_', '-');
    if (!normalized) return null;
    const [base, region] = normalized.split('-');
    const lowerBase = String(base || '').toLowerCase();
    const full = region ? `${lowerBase}-${String(region).toUpperCase()}` : '';
    if (DOWNLOADER_LOCALES[full]) return full;
    if (lowerBase === 'tr') return 'tr-TR';
    if (lowerBase === 'ar') return 'ar-SA';
    return 'en-US';
}

function formatDlText(value, vars) {
    if (!vars || typeof vars !== 'object') return String(value);
    return String(value).replace(/\{(\w+)\}/g, (_match, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
}

function dlt(key, vars) {
    const messages = DOWNLOADER_LOCALES[currentDownloaderLang] || DOWNLOADER_LOCALES['en-US'];
    const own = messages[key];
    if (typeof own === 'string') return formatDlText(own, vars);
    const raw = DOWNLOADER_LOCALES['en-US'][key] || key;
    return formatDlText(raw, vars);
}

function applyDownloaderTranslations() {
    document.querySelectorAll('[data-dl-i18n]').forEach((el) => {
        el.textContent = dlt(el.getAttribute('data-dl-i18n'));
    });
    document.querySelectorAll('[data-dl-i18n-html]').forEach((el) => {
        el.innerHTML = dlt(el.getAttribute('data-dl-i18n-html'));
    });
    document.querySelectorAll('[data-dl-i18n-title]').forEach((el) => {
        el.setAttribute('title', dlt(el.getAttribute('data-dl-i18n-title')));
    });
    document.querySelectorAll('[data-dl-i18n-placeholder]').forEach((el) => {
        el.setAttribute('placeholder', dlt(el.getAttribute('data-dl-i18n-placeholder')));
    });
    document.querySelectorAll('[data-dl-i18n-aria-label]').forEach((el) => {
        el.setAttribute('aria-label', dlt(el.getAttribute('data-dl-i18n-aria-label')));
    });
    if (state.page === 'history') renderHistory();
    if (state.page === 'compressor') {
        renderCompressorFiles();
        syncCompressorOutputState();
    }
    if (els.statusPanel?.classList.contains('idle') && !els.statusTitle.textContent) return;
}

function setDownloaderLanguage(lang) {
    const nextLang = normalizeDownloaderLang(lang) || 'en-US';
    currentDownloaderLang = nextLang;
    document.documentElement.lang = nextLang;
    document.documentElement.dir = nextLang === 'ar-SA' ? 'rtl' : 'ltr';
    document.body?.classList.toggle('rtl', nextLang === 'ar-SA');
    applyDownloaderTranslations();
}

async function initDownloaderLanguage() {
    let lang = null;
    try {
        const settings = await window.aurivo?.loadSettings?.();
        lang = settings?.ui?.language || settings?.language || settings?.lang;
    } catch {
        // ignore
    }
    if (!lang) {
        try {
            lang = await window.aurivo?.i18n?.getSystemLocale?.();
        } catch {
            // ignore
        }
    }
    setDownloaderLanguage(lang || navigator.language);
    window.aurivo?.onSettingsReload?.((settings) => {
        const nextLang = settings?.ui?.language || settings?.language || settings?.lang;
        if (nextLang) setDownloaderLanguage(nextLang);
    });
}

const els = {
    minimizeBtn: document.getElementById('minimizeBtn'),
    maximizeBtn: document.getElementById('maximizeBtn'),
    closeBtn: document.getElementById('closeBtn'),
    urlInput: document.getElementById('urlInput'),
    pasteBtn: document.getElementById('pasteBtn'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    statusPanel: document.getElementById('statusPanel'),
    statusTitle: document.getElementById('statusTitle'),
    statusText: document.getElementById('statusText'),
    errorDetailsBtn: document.getElementById('errorDetailsBtn'),
    errorDetailsBox: document.getElementById('errorDetailsBox'),
    mediaPanel: document.getElementById('mediaPanel'),
    hideMediaPanelBtn: document.getElementById('hideMediaPanelBtn'),
    thumb: document.getElementById('thumb'),
    mediaTitle: document.getElementById('mediaTitle'),
    mediaSource: document.getElementById('mediaSource'),
    videoFormat: document.getElementById('videoFormat'),
    audioForVideoFormat: document.getElementById('audioForVideoFormat'),
    audioFormat: document.getElementById('audioFormat'),
    extractFormat: document.getElementById('extractFormat'),
    audioQuality: document.getElementById('audioQuality'),
    videoFormatRow: document.getElementById('videoFormatRow'),
    audioForVideoRow: document.getElementById('audioForVideoRow'),
    audioFormatRow: document.getElementById('audioFormatRow'),
    extractFormatRow: document.getElementById('extractFormatRow'),
    audioQualityRow: document.getElementById('audioQualityRow'),
    moreOptionsBtn: document.getElementById('moreOptionsBtn'),
    startTime: document.getElementById('startTime'),
    endTime: document.getElementById('endTime'),
    customArgs: document.getElementById('customArgs'),
    subtitles: document.getElementById('subtitles'),
    closeOnFinish: document.getElementById('closeOnFinish'),
    downloadPath: document.getElementById('downloadPath'),
    chooseFolderBtn: document.getElementById('chooseFolderBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    extractBtn: document.getElementById('extractBtn'),
    jobsPanel: document.querySelector('.jobs'),
    clearDoneBtn: document.getElementById('clearDoneBtn'),
    jobsList: document.getElementById('jobsList'),
    workspaceTabs: document.querySelectorAll('.workspace-tab'),
    pagePanels: document.querySelectorAll('.page-panel'),
    playlistUrl: document.getElementById('playlistUrl'),
    playlistType: document.getElementById('playlistType'),
    playlistVideoToggle: document.getElementById('playlistVideoToggle'),
    playlistAudioToggle: document.getElementById('playlistAudioToggle'),
    playlistVideoBox: document.getElementById('playlistVideoBox'),
    playlistAudioBox: document.getElementById('playlistAudioBox'),
    playlistVideoQuality: document.getElementById('playlistVideoQuality'),
    playlistVideoFormat: document.getElementById('playlistVideoFormat'),
    playlistAudioFormat: document.getElementById('playlistAudioFormat'),
    playlistAudioQuality: document.getElementById('playlistAudioQuality'),
    playlistStart: document.getElementById('playlistStart'),
    playlistEnd: document.getElementById('playlistEnd'),
    playlistFolderTemplate: document.getElementById('playlistFolderTemplate'),
    playlistFileTemplate: document.getElementById('playlistFileTemplate'),
    playlistSubtitles: document.getElementById('playlistSubtitles'),
    playlistPasteBtn: document.getElementById('playlistPasteBtn'),
    playlistDownloadPath: document.getElementById('playlistDownloadPath'),
    playlistChooseFolderBtn: document.getElementById('playlistChooseFolderBtn'),
    playlistDownloadBtn: document.getElementById('playlistDownloadBtn'),
    playlistAudioDownloadBtn: document.getElementById('playlistAudioDownloadBtn'),
    playlistThumbnailsBtn: document.getElementById('playlistThumbnailsBtn'),
    playlistLinksBtn: document.getElementById('playlistLinksBtn'),
    historySearch: document.getElementById('historySearch'),
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    exportHistoryJsonBtn: document.getElementById('exportHistoryJsonBtn'),
    exportHistoryCsvBtn: document.getElementById('exportHistoryCsvBtn'),
    historyFormatFilter: document.getElementById('historyFormatFilter'),
    historyStatusFilter: document.getElementById('historyStatusFilter'),
    historyTotalCount: document.getElementById('historyTotalCount'),
    historyDoneCount: document.getElementById('historyDoneCount'),
    historyIssueCount: document.getElementById('historyIssueCount'),
    historyList: document.getElementById('historyList'),
    menuBtn: document.getElementById('menuBtn'),
    appMenu: document.getElementById('appMenu'),
    menuItems: document.querySelectorAll('.menu-item'),
    themeSelect: document.getElementById('themeSelect'),
    dependencyOverlay: document.getElementById('dependencyOverlay'),
    dependencyProgressText: document.getElementById('dependencyProgressText'),
    settingsDownloadPath: document.getElementById('settingsDownloadPath'),
    settingsHomeBtn: document.getElementById('settingsHomeBtn'),
    settingsRestartBtn: document.getElementById('settingsRestartBtn'),
    settingsChooseFolderBtn: document.getElementById('settingsChooseFolderBtn'),
    settingsVideoQuality: document.getElementById('settingsVideoQuality'),
    settingsVideoCodec: document.getElementById('settingsVideoCodec'),
    settingsAudioFormat: document.getElementById('settingsAudioFormat'),
    settingsBrowserCookies: document.getElementById('settingsBrowserCookies'),
    settingsProxy: document.getElementById('settingsProxy'),
    settingsCustomArgs: document.getElementById('settingsCustomArgs'),
    settingsUseConfigFile: document.getElementById('settingsUseConfigFile'),
    settingsConfigPath: document.getElementById('settingsConfigPath'),
    settingsChooseConfigBtn: document.getElementById('settingsChooseConfigBtn'),
    settingsShowMoreFormats: document.getElementById('settingsShowMoreFormats'),
    settingsPlaylistFileTemplate: document.getElementById('settingsPlaylistFileTemplate'),
    settingsPlaylistFolderTemplate: document.getElementById('settingsPlaylistFolderTemplate'),
    resetPlaylistFileTemplateBtn: document.getElementById('resetPlaylistFileTemplateBtn'),
    resetPlaylistFolderTemplateBtn: document.getElementById('resetPlaylistFolderTemplateBtn'),
    settingsMaxDownloads: document.getElementById('settingsMaxDownloads'),
    settingsCloseToTray: document.getElementById('settingsCloseToTray'),
    settingsDisableAutoUpdates: document.getElementById('settingsDisableAutoUpdates'),
    prepareDependenciesBtn: document.getElementById('prepareDependenciesBtn'),
    ytdlpStatus: document.getElementById('ytdlpStatus'),
    ytdlpPath: document.getElementById('ytdlpPath'),
    ffmpegStatus: document.getElementById('ffmpegStatus'),
    ffmpegPath: document.getElementById('ffmpegPath'),
    compressorDropZone: document.getElementById('compressorDropZone'),
    compressorFileInput: document.getElementById('compressorFileInput'),
    compressorExtension: document.getElementById('compressorExtension'),
    compressorEncoder: document.getElementById('compressorEncoder'),
    compressorSpeed: document.getElementById('compressorSpeed'),
    compressorQuality: document.getElementById('compressorQuality'),
    compressorQualityValue: document.getElementById('compressorQualityValue'),
    compressorAudioFormat: document.getElementById('compressorAudioFormat'),
    compressorSuffix: document.getElementById('compressorSuffix'),
    compressorSameFolder: document.getElementById('compressorSameFolder'),
    compressorOutputPath: document.getElementById('compressorOutputPath'),
    compressorChooseOutputBtn: document.getElementById('compressorChooseOutputBtn'),
    compressorFileList: document.getElementById('compressorFileList'),
    compressorClearFilesBtn: document.getElementById('compressorClearFilesBtn'),
    compressorStartBtn: document.getElementById('compressorStartBtn'),
    compressorCancelBtn: document.getElementById('compressorCancelBtn')
};

const state = {
    mode: 'video',
    page: 'single',
    info: null,
    settings: {},
    jobs: new Map(),
    history: [],
    compressorFiles: [],
    compressorOutputDir: '',
    compressorBatchId: ''
};

const pendingJobUpdates = new Map();
let jobUpdateFrame = 0;

function enqueueJobUpdate(payload) {
    if (!payload?.id) return;
    pendingJobUpdates.set(payload.id, payload);
    if (jobUpdateFrame) return;
    jobUpdateFrame = window.requestAnimationFrame(() => {
        jobUpdateFrame = 0;
        const updates = [...pendingJobUpdates.values()];
        pendingJobUpdates.clear();
        for (const update of updates) {
            createOrUpdateJob(update);
            if (update.batchDone) {
                state.compressorBatchId = '';
                els.compressorStartBtn.disabled = false;
                els.compressorCancelBtn.disabled = true;
            }
            if (update.state === 'done' && update.closeOnFinish) {
                electronApi?.closeWindow();
            }
        }
        if (updates.some((update) => ['done', 'error', 'cancelled'].includes(update.state)) && state.page === 'history') {
            loadHistory();
        }
    });
}

function setStatus(kind, title, text) {
    els.statusPanel.className = `status-panel ${kind || 'idle'}`;
    els.statusTitle.textContent = title;
    els.statusText.textContent = text;
    const isError = kind === 'error';
    els.errorDetailsBtn?.classList.toggle('hidden', !isError);
    els.errorDetailsBox?.classList.add('hidden');
    if (els.errorDetailsBox) {
        els.errorDetailsBox.textContent = isError ? sanitizeErrorInstruction(text) : '';
    }
}

function showNoUrlNotice() {
    setBusy(false);
    switchPage('single');
    setStatus(
        'error',
        dlt('error.noUrl.title'),
        dlt('error.noUrl.detail')
    );
}

function sanitizeErrorInstruction(value) {
    return String(value || dlt('error.noUrl.detail'))
        .replace(/[.,:]/g, '')
        .trim();
}

function setBusy(busy) {
    els.analyzeBtn.disabled = busy;
    els.downloadBtn.disabled = busy || !state.info;
}

function formatJobPercent(value) {
    const percent = Math.max(0, Math.min(100, Number(value || 0)));
    if (percent <= 0) return '';
    return String(Math.round(percent));
}

function formatJobState(payload, percent) {
    if (payload.state === 'done') return dlt('history.completed');
    if (payload.state === 'error') return payload.message || dlt('common.error');
    if (payload.state === 'cancelled') return payload.message || dlt('common.cancelled');
    const message = String(payload.message || payload.state || '').trim();
    return message || '';
}

function showFormatSettings() {
    if (!state.info) return;
    switchPage('single');
    els.mediaPanel.classList.remove('hidden');
    setStatus('idle', dlt('single.analysisDone'), dlt('single.analysisDoneDetail'));
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function fillSelect(select, items, emptyText) {
    select.textContent = '';
    if (!items.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = emptyText;
        select.append(option);
        return;
    }
    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.dataset.height = item.height || '';
        option.dataset.ext = item.ext || '';
        option.dataset.vcodec = item.vcodec || '';
        option.dataset.acodec = item.acodec || '';
        option.dataset.abr = item.abr || '';
        select.append(option);
    }
}

function selectPreferredVideoFormat() {
    const targetHeight = Number(state.settings.preferredVideoQuality || 1080);
    const targetCodec = String(state.settings.preferredVideoCodec || '').toLowerCase();
    const options = [...els.videoFormat.options].filter((option) => option.value);
    if (!options.length) return;
    const exact = options.find((option) => {
        const height = Number(option.dataset.height || 0);
        const codec = String(option.dataset.vcodec || '').toLowerCase();
        return height === targetHeight && (!targetCodec || codec.includes(targetCodec));
    });
    const under = options.find((option) => Number(option.dataset.height || 0) <= targetHeight);
    els.videoFormat.value = (exact || under || options[0]).value;
}

function selectPreferredAudioFormat() {
    const targetExt = String(state.settings.preferredAudioFormat || 'mp3').toLowerCase();
    const options = [...els.audioFormat.options].filter((option) => option.value);
    const matching = options.find((option) => String(option.dataset.ext || '').toLowerCase() === targetExt);
    if (matching) els.audioFormat.value = matching.value;
    const videoAudioOptions = [...els.audioForVideoFormat.options].filter((option) => option.value && option.value !== 'none');
    const bestForVideo = videoAudioOptions.find((option) => ['m4a', 'mp4'].includes(String(option.dataset.ext || '').toLowerCase()))
        || videoAudioOptions.find((option) => ['webm', 'opus'].includes(String(option.dataset.ext || '').toLowerCase()));
    if (bestForVideo || videoAudioOptions[0]) {
        els.audioForVideoFormat.value = (bestForVideo || videoAudioOptions[0]).value;
    }
}

function getSelectedOption(select) {
    return select?.selectedOptions?.[0] || null;
}

function showProcessingHome() {
    els.mediaPanel.classList.add('hidden');
    setStatus('idle', '', '');
    setBusy(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderInfo(info) {
    state.info = info;
    els.mediaPanel.classList.remove('hidden');
    if (els.thumb) els.thumb.src = info.thumbnail || '';
    els.mediaTitle.textContent = info.title || dlt('single.titleFallback');
    els.mediaSource.textContent = `${info.extractor || dlt('single.sourceFallback')}${info.durationText ? ` • ${info.durationText}` : ''}`;
    fillSelect(els.videoFormat, info.videoFormats || [], dlt('single.noVideoFormat'));
    fillSelect(els.audioForVideoFormat, [{ id: 'none', label: dlt('common.none') }, ...(info.audioFormats || [])], dlt('single.noAudioFormat'));
    fillSelect(els.audioFormat, info.audioFormats || [], dlt('single.noAudioFormat'));
    selectPreferredVideoFormat();
    selectPreferredAudioFormat();
    setBusy(false);
    setStatus('idle', dlt('single.analysisDone'), dlt('single.analysisDoneDetail'));
    renderMode();
}

function renderMode() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === state.mode);
    });
    const isVideo = state.mode === 'video';
    const isAudio = state.mode === 'audio';
    const isExtract = state.mode === 'extract';
    els.videoFormatRow.classList.toggle('hidden', !isVideo);
    els.audioForVideoRow.classList.toggle('hidden', !isVideo);
    els.audioFormatRow.classList.toggle('hidden', !isAudio);
    els.extractFormatRow?.classList.toggle('hidden', !isExtract);
    els.audioQualityRow?.classList.toggle('hidden', !(isAudio || isExtract));
}

function switchPage(page) {
    state.page = page;
    document.body.dataset.page = page;
    if (page !== 'single' && els.statusPanel.classList.contains('error')) {
        setStatus('idle', '', '');
    }
    els.workspaceTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.page === page);
    });
    els.pagePanels.forEach((panel) => {
        const panelPage = panel.dataset.pagePanel;
        const shouldShow = panelPage === page && (panel !== els.mediaPanel || !!state.info);
        panel.classList.toggle('hidden', !shouldShow);
    });
    setMenuOpen(false);
    if (page === 'history') loadHistory();
}

function setMenuOpen(open) {
    els.appMenu.classList.toggle('hidden', !open);
    els.menuBtn.classList.toggle('open', !!open);
    els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function applyTheme(theme) {
    const nextTheme = String(theme || 'dark');
    document.documentElement.setAttribute('theme', nextTheme);
    localStorage.setItem('aurivoDawlodTheme', nextTheme);
    localStorage.setItem('theme', nextTheme);
    if (els.themeSelect) els.themeSelect.value = nextTheme;
}

async function saveThemeSetting(theme) {
    applyTheme(theme);
    state.settings = await api.saveSettings({ theme });
}

function renderDependencyStatus(status) {
    const ytdlp = status?.ytdlp || {};
    const ffmpeg = status?.ffmpeg || {};
    els.ytdlpStatus.textContent = ytdlp.installed ? dlt('dependency.ready') : dlt('dependency.missing');
    els.ytdlpStatus.className = ytdlp.installed ? 'ready' : 'missing';
    els.ytdlpPath.textContent = ytdlp.path || ytdlp.managedPath || '';
    els.ffmpegStatus.textContent = ffmpeg.installed ? dlt('dependency.ready') : dlt('dependency.missing');
    els.ffmpegStatus.className = ffmpeg.installed ? 'ready' : 'missing';
    els.ffmpegPath.textContent = ffmpeg.path || ffmpeg.managedPath || '';
}

async function refreshDependencyStatus() {
    const status = await api.getDependencyStatus();
    renderDependencyStatus(status);
    return status;
}

async function prepareDependencies() {
    els.prepareDependenciesBtn.disabled = true;
    showDependencyOverlay(0);
    const result = await api.ensureDependencies();
    if (result?.status) renderDependencyStatus(result.status);
    els.prepareDependenciesBtn.disabled = false;
    hideDependencyOverlay();
    if (!result?.success) {
        setStatus('error', dlt('dependency.prepareFailed'), result?.error || dlt('common.unknownError'));
        return;
    }
    setStatus('idle', dlt('common.ready'), dlt('single.readyDetail'));
}

function showDependencyOverlay(percent = 0) {
    els.dependencyProgressText.textContent = dlt('dependency.progress', { percent: formatPercent(percent) });
    els.dependencyOverlay.classList.remove('hidden');
}

function hideDependencyOverlay() {
    els.dependencyOverlay.classList.add('hidden');
}

function formatPercent(value) {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
}

async function savePreferenceSettings() {
    state.settings = await api.saveSettings({
        preferredVideoQuality: els.settingsVideoQuality.value,
        preferredVideoCodec: els.settingsVideoCodec.value,
        preferredAudioFormat: els.settingsAudioFormat.value,
        browserCookies: els.settingsBrowserCookies.value,
        proxy: els.settingsProxy.value,
        customArgs: els.settingsCustomArgs.value,
        useConfigFile: els.settingsUseConfigFile.checked,
        showMoreFormats: els.settingsShowMoreFormats.checked,
        playlistFileTemplate: els.settingsPlaylistFileTemplate.value,
        playlistFolderTemplate: els.settingsPlaylistFolderTemplate.value,
        maxActiveDownloads: els.settingsMaxDownloads.value,
        closeToTray: els.settingsCloseToTray.checked,
        disableAutoUpdates: els.settingsDisableAutoUpdates.checked
    });
}

async function saveCompressorSettings() {
    state.settings = await api.saveSettings({
        compressorExtension: els.compressorExtension.value,
        compressorEncoder: els.compressorEncoder.value,
        compressorSpeed: els.compressorSpeed.value,
        compressorQuality: els.compressorQuality.value,
        compressorAudioFormat: els.compressorAudioFormat.value,
        compressorSuffix: els.compressorSuffix.value,
        compressorSameFolder: els.compressorSameFolder.checked,
        compressorOutputDir: state.compressorOutputDir
    });
}

function buildDownloadPayload() {
    const info = state.info || {};
    const videoOption = getSelectedOption(els.videoFormat);
    const audioForVideoOption = getSelectedOption(els.audioForVideoFormat);
    const audioOption = getSelectedOption(els.audioFormat);
    return {
        mode: state.mode,
        url: info.url,
        title: info.title,
        thumbnail: info.thumbnail,
        videoFormatId: els.videoFormat.value,
        videoFormatExt: videoOption?.dataset.ext || '',
        videoFormatCodec: videoOption?.dataset.vcodec || '',
        audioForVideoFormatId: els.audioForVideoFormat.value,
        audioForVideoFormatExt: audioForVideoOption?.dataset.ext || '',
        audioFormatId: els.audioFormat.value,
        audioFormatExt: audioOption?.dataset.ext || '',
        extractFormat: els.extractFormat.value,
        audioQuality: els.audioQuality.value,
        startTime: els.startTime.value,
        endTime: els.endTime.value,
        customArgs: els.customArgs.value,
        subtitles: els.subtitles.checked,
        closeOnFinish: els.closeOnFinish.checked
    };
}

function buildPlaylistPayload() {
    return {
        mode: els.playlistType.value,
        url: els.playlistUrl.value.trim(),
        title: 'Playlist',
        playlistVideoQuality: els.playlistVideoQuality.value,
        playlistVideoFormat: els.playlistVideoFormat.value,
        playlistAudioFormat: els.playlistAudioFormat.value,
        playlistAudioQuality: els.playlistAudioQuality.value,
        playlistStart: els.playlistStart.value,
        playlistEnd: els.playlistEnd.value,
        playlistFolderTemplate: els.playlistFolderTemplate.value || state.settings.playlistFolderTemplate,
        playlistFileTemplate: els.playlistFileTemplate.value || state.settings.playlistFileTemplate,
        playlistSubtitles: els.playlistSubtitles.checked,
        customArgs: els.customArgs.value,
        closeOnFinish: els.closeOnFinish.checked
    };
}

function setPlaylistMode(mode) {
    const nextMode = String(mode || 'playlist-video');
    els.playlistType.value = nextMode;
    const isVideo = nextMode === 'playlist-video';
    els.playlistVideoToggle.classList.toggle('active', isVideo);
    els.playlistAudioToggle.classList.toggle('active', !isVideo);
    els.playlistVideoBox.classList.toggle('hidden', !isVideo);
    els.playlistAudioBox.classList.toggle('hidden', isVideo);
}

function getBasename(filePath) {
    return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function renderCompressorFiles() {
    els.compressorFileList.textContent = '';
    if (!state.compressorFiles.length) {
        const empty = document.createElement('p');
        empty.className = 'history-meta';
        empty.textContent = dlt('compressor.emptyFiles');
        els.compressorFileList.append(empty);
        return;
    }

    state.compressorFiles.forEach((filePath, index) => {
        const row = document.createElement('article');
        row.className = 'compressor-file';
        row.innerHTML = `
            <div>
                <strong></strong>
                <span></span>
            </div>
            <button class="ghost" title="${dlt('action.clear')}" aria-label="${dlt('action.clear')}">×</button>
        `;
        row.querySelector('strong').textContent = getBasename(filePath);
        row.querySelector('span').textContent = filePath;
        row.querySelector('button').addEventListener('click', () => {
            state.compressorFiles.splice(index, 1);
            renderCompressorFiles();
        });
        els.compressorFileList.append(row);
    });
}

async function addCompressorFiles(fileList) {
    const files = [...(fileList || [])];
    const nextPaths = [];
    for (const file of files) {
        const filePath = api.getPathForFile?.(file) || '';
        if (filePath) nextPaths.push(filePath);
    }
    const merged = [...state.compressorFiles, ...nextPaths];
    state.compressorFiles = [...new Set(merged)];
    renderCompressorFiles();
}

function syncCompressorOutputState() {
    const sameFolder = els.compressorSameFolder.checked;
    els.compressorChooseOutputBtn.disabled = sameFolder;
    els.compressorOutputPath.textContent = sameFolder
        ? dlt('compressor.sameFolderUsed')
        : (state.compressorOutputDir || dlt('compressor.selectOutputFolder'));
}

function buildCompressionPayload() {
    return {
        files: state.compressorFiles,
        extension: els.compressorExtension.value,
        encoder: els.compressorEncoder.value,
        speed: els.compressorSpeed.value,
        videoQuality: els.compressorQuality.value,
        audioFormat: els.compressorAudioFormat.value,
        outputSuffix: els.compressorSuffix.value,
        sameFolder: els.compressorSameFolder.checked,
        outputDir: state.compressorOutputDir
    };
}

async function startCompression() {
    if (!state.compressorFiles.length) {
        setStatus('error', dlt('error.fileRequired'), dlt('error.fileRequiredDetail'));
        return;
    }
    if (!els.compressorSameFolder.checked && !state.compressorOutputDir) {
        setStatus('error', dlt('error.outputRequired'), dlt('error.outputRequiredDetail'));
        return;
    }
    els.compressorStartBtn.disabled = true;
    els.compressorCancelBtn.disabled = false;
    setStatus('busy', dlt('compressor.starting'), dlt('compressor.startingDetail'));
    const result = await api.startCompression(buildCompressionPayload());
    if (!result?.success) {
        els.compressorStartBtn.disabled = false;
        els.compressorCancelBtn.disabled = true;
        setStatus('error', dlt('compressor.starting'), result?.error || dlt('common.unknownError'));
        return;
    }
    state.compressorBatchId = result.job?.id || '';
    setStatus('idle', dlt('compressor.started'), dlt('compressor.startedDetail'));
}

async function startPlaylistModeDownload(mode) {
    const previous = els.playlistType.value;
    els.playlistType.value = mode || previous;
    await startPlaylistDownload();
    els.playlistType.value = previous;
}

function syncJobsPanel() {
    const rows = [...state.jobs.values()].filter((row) => row?.isConnected);
    const hasJobs = rows.length > 0;
    const hasFinishedJobs = rows.some((row) =>
        row.classList.contains('done') ||
        row.classList.contains('error') ||
        row.classList.contains('cancelled')
    );
    els.jobsPanel?.classList.toggle('hidden', !hasJobs);
    els.clearDoneBtn?.classList.toggle('hidden', !hasFinishedJobs);
}

function createOrUpdateJob(payload) {
    const id = payload.id;
    const isDependencyJob = id.startsWith('dependency-');
    if (isDependencyJob) {
        showDependencyOverlay(payload.percent || 0);
        if (payload.state === 'done') {
            els.dependencyProgressText.textContent = dlt('dependency.progress', { percent: '100%' });
            window.setTimeout(hideDependencyOverlay, 450);
        }
        if (payload.state === 'error' || payload.state === 'cancelled') {
            window.setTimeout(hideDependencyOverlay, 900);
        }
        return;
    }
    let row = state.jobs.get(id);
    if (!row) {
        row = document.createElement('article');
        row.className = isDependencyJob ? 'job dependency-job' : 'job';
        row.innerHTML = `
            <div class="job-thumb-wrap">
                <img class="job-thumb" alt="">
                <span class="job-type"></span>
            </div>
            <button class="job-close cancel-btn" title="${dlt('action.cancel')}" aria-label="${dlt('action.cancel')}">×</button>
            <div class="job-body">
                <strong class="job-title"></strong>
                <span class="job-state"></span>
                <div class="progress-row">
                    <div class="progress-track"><div class="progress-fill"></div></div>
                    <span class="job-percent"></span>
                </div>
                <p class="job-detail"></p>
            </div>
            <div class="job-actions">
                <button class="ghost show-btn hidden">${dlt('jobs.folderShow')}</button>
                <button class="secondary format-btn hidden">${dlt('jobs.formatBack')}</button>
            </div>
        `;
        row.querySelector('.cancel-btn').addEventListener('click', () => api.cancel(id));
        row.querySelector('.show-btn').addEventListener('click', () => {
            const target = row.dataset.outputPath || '';
            if (target) api.showFile(target);
        });
        row.querySelector('.format-btn').addEventListener('click', showFormatSettings);
        els.jobsList.prepend(row);
        state.jobs.set(id, row);
    }

    row.classList.toggle('done', payload.state === 'done');
    row.classList.toggle('error', payload.state === 'error');
    row.classList.toggle('cancelled', payload.state === 'cancelled');
    row.classList.toggle('processing', payload.message === 'İşleniyor');
    row.classList.toggle('indeterminate', payload.state === 'running' && Number(payload.percent || 0) <= 0);
    const percent = Math.max(0, Math.min(100, Number(payload.percent || 0)));
    row.querySelector('.job-title').textContent = payload.title || dlt('action.download');
    row.querySelector('.job-state').textContent = formatJobState(payload, percent);
    row.querySelector('.job-detail').textContent = payload.detail || '';
    row.querySelector('.job-thumb').src = payload.thumbnail || 'icons/aurivo_dawlod.png';
    row.querySelector('.job-type').textContent = payload.mode === 'audio' || payload.mode === 'extract' ? dlt('mode.audio') : dlt('mode.video');
    row.querySelector('.job-percent').textContent = formatJobPercent(percent);
    row.querySelector('.progress-fill').style.width = row.classList.contains('indeterminate') ? '34%' : `${percent}%`;
    row.querySelector('.cancel-btn').classList.toggle('hidden', isDependencyJob || ['done', 'error', 'cancelled'].includes(payload.state));
    if (payload.outputPath) {
        row.dataset.outputPath = payload.outputPath;
    }
    row.querySelector('.show-btn').classList.toggle('hidden', !row.dataset.outputPath || payload.state !== 'done');
    row.querySelector('.format-btn').classList.toggle('hidden', payload.state !== 'done' || !state.info);
    syncJobsPanel();
    if (isDependencyJob && payload.state === 'done') {
        window.setTimeout(() => {
            row.remove();
            state.jobs.delete(id);
            syncJobsPanel();
        }, 450);
    }
}

async function analyze() {
    const url = els.urlInput.value.trim();
    if (!url) {
        setStatus('error', dlt('status.urlRequired'), dlt('status.urlRequiredDetail'));
        return;
    }
    setBusy(true);
    setStatus('busy', dlt('status.processing'), '');
    const result = await api.getInfo(url);
    if (!result?.success) {
        setBusy(false);
        setStatus('error', dlt('error.analysisFailed'), result?.error || dlt('error.videoInfoFailed'));
        return;
    }
    renderInfo(result.info);
}

async function analyzeUrl(url) {
    const normalized = String(url || '').trim();
    if (!/^https?:\/\//i.test(normalized)) return;
    els.urlInput.value = normalized;
    switchPage('single');
    await analyze();
}

async function startDownload() {
    if (!state.info) return;
    setStatus('busy', dlt('status.downloadPreparing'), dlt('status.downloadPreparingDetail'));
    const result = await api.start(buildDownloadPayload());
    if (!result?.success) {
        setStatus('error', dlt('status.downloadStartFailed'), result?.error || dlt('common.unknownError'));
        return;
    }
    showProcessingHome();
}

async function startExtractDownload() {
    if (!state.info) return;
    const previousMode = state.mode;
    state.mode = 'extract';
    const payload = buildDownloadPayload();
    state.mode = previousMode;
    setStatus('busy', dlt('status.extractPreparing'), dlt('status.extractPreparingDetail'));
    const result = await api.start(payload);
    if (!result?.success) {
        setStatus('error', dlt('status.extractFailed'), result?.error || dlt('common.unknownError'));
        return;
    }
    showProcessingHome();
}

async function startPlaylistDownload() {
    const payload = buildPlaylistPayload();
    if (!payload.url) {
        setStatus('error', dlt('status.playlistUrlRequired'), dlt('status.playlistUrlRequiredDetail'));
        return;
    }
    setStatus('busy', dlt('status.playlistPreparing'), dlt('status.playlistPreparingDetail'));
    const result = await api.start(payload);
    if (!result?.success) {
        setStatus('error', dlt('status.playlistFailed'), result?.error || dlt('common.unknownError'));
        return;
    }
    setStatus('idle', dlt('status.playlistDownloading'), dlt('status.playlistDownloadingDetail'));
}

function formatHistoryDate(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(currentDownloaderLang || 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderHistory() {
    const query = String(els.historySearch.value || '').trim().toLowerCase();
    const filter = String(els.historyFormatFilter.value || '').trim().toLowerCase();
    const statusFilter = String(els.historyStatusFilter.value || '').trim().toLowerCase();
    const stats = state.history.reduce((acc, item) => {
        const format = String(item.format || '').toLowerCase();
        const status = String(item.status || 'done').toLowerCase();
        acc.total += 1;
        if (status === 'done') acc.done += 1;
        if (status === 'error' || status === 'cancelled') acc.issue += 1;
        if (format === 'video' || format === 'playlist-video') acc.video += 1;
        if (format === 'audio' || format === 'extract' || format.startsWith('playlist-')) acc.audio += 1;
        return acc;
    }, { total: 0, done: 0, issue: 0, video: 0, audio: 0 });
    els.historyTotalCount.textContent = String(stats.total);
    els.historyDoneCount.textContent = String(stats.done);
    els.historyIssueCount.textContent = String(stats.issue);

    const items = state.history.filter((item) => {
        const format = String(item.format || '').toLowerCase();
        const status = String(item.status || 'done').toLowerCase();
        const matchesQuery = !query ||
            String(item.title || '').toLowerCase().includes(query) ||
            String(item.url || '').toLowerCase().includes(query) ||
            String(item.filePath || '').toLowerCase().includes(query) ||
            format.includes(query);
        const matchesFilter = !filter ||
            (filter === 'playlist' ? format.startsWith('playlist-') : format === filter || format === `playlist-${filter}`);
        const matchesStatus = !statusFilter || status === statusFilter;
        return matchesQuery && matchesFilter && matchesStatus;
    });

    els.historyList.textContent = '';
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'history-meta';
        empty.textContent = dlt('history.empty');
        els.historyList.append(empty);
        return;
    }

    for (const item of items) {
        const status = String(item.status || 'done').toLowerCase();
        const row = document.createElement('article');
        row.className = `history-item ${status}`;
        row.innerHTML = `
            <img class="history-thumb" alt="">
            <div>
                <strong class="history-title"></strong>
                <div class="history-meta"></div>
                <div class="history-detail"></div>
            </div>
            <div class="history-item-actions">
                <span class="history-status"></span>
                <button class="secondary show-history-btn">${dlt('history.show')}</button>
                <button class="ghost delete-history-btn">${dlt('action.clear')}</button>
            </div>
        `;
        row.querySelector('.history-thumb').src = item.thumbnail || 'icons/aurivo_dawlod.png';
        row.querySelector('.history-title').textContent = item.title || dlt('action.download');
        const meta = row.querySelector('.history-meta');
        const metaParts = [
            item.format || 'unknown',
            formatHistoryDate(item.downloadDate || item.downloadedAt || item.timestamp),
            item.filename || getBasename(item.filePath || ''),
            item.fileSize ? `${(Number(item.fileSize) / 1024 / 1024).toFixed(2)} MB` : ''
        ].filter(Boolean);
        for (const part of metaParts) {
            const span = document.createElement('span');
            span.textContent = part;
            meta.append(span);
        }
        const detail = row.querySelector('.history-detail');
        detail.textContent = item.error || item.filePath || item.url || '';
        const badge = row.querySelector('.history-status');
        badge.classList.add(status);
        badge.textContent = status === 'error' ? dlt('common.error') : status === 'cancelled' ? dlt('common.cancelled') : dlt('history.completed');
        row.querySelector('.show-history-btn').addEventListener('click', () => api.showFile(item.filePath || ''));
        row.querySelector('.show-history-btn').disabled = !item.filePath || status !== 'done';
        row.querySelector('.delete-history-btn').addEventListener('click', async () => {
            await api.removeHistoryItem(item.id);
            await loadHistory();
        });
        els.historyList.append(row);
    }
}

async function loadHistory() {
    state.history = await api.getHistory();
    renderHistory();
}

async function init() {
    await initDownloaderLanguage();
    if (!api) {
        setStatus('error', dlt('error.bridgeMissing'), dlt('error.apiMissing'));
        return;
    }
    state.settings = await api.getSettings();
    els.downloadPath.textContent = state.settings.downloadDir || '';
    els.playlistDownloadPath.textContent = state.settings.downloadDir || '';
    els.settingsDownloadPath.textContent = state.settings.downloadDir || '';
    els.customArgs.value = state.settings.customArgs || '';
    els.closeOnFinish.checked = state.settings.closeOnFinish === true;
    els.settingsVideoQuality.value = String(state.settings.preferredVideoQuality || '1080');
    els.settingsVideoCodec.value = String(state.settings.preferredVideoCodec || 'avc1');
    els.settingsAudioFormat.value = String(state.settings.preferredAudioFormat || 'mp3');
    els.settingsBrowserCookies.value = String(state.settings.browserCookies || '');
    els.settingsProxy.value = String(state.settings.proxy || '');
    els.settingsCustomArgs.value = String(state.settings.customArgs || '');
    els.settingsUseConfigFile.checked = state.settings.useConfigFile === true;
    els.settingsConfigPath.textContent = state.settings.configPath || dlt('common.none');
    els.settingsShowMoreFormats.checked = state.settings.showMoreFormats === true;
    els.settingsPlaylistFileTemplate.value = String(state.settings.playlistFileTemplate || '%(playlist_index)s.%(title)s.%(ext)s');
    els.settingsPlaylistFolderTemplate.value = String(state.settings.playlistFolderTemplate || '%(playlist_title)s');
    els.settingsMaxDownloads.value = String(Math.max(1, Math.min(2, Number(state.settings.maxActiveDownloads || 1) || 1)));
    els.settingsCloseToTray.checked = state.settings.closeToTray === true;
    els.settingsDisableAutoUpdates.checked = state.settings.disableAutoUpdates === true;
    els.playlistVideoQuality.value = String(state.settings.preferredVideoQuality || '1080');
    els.playlistAudioFormat.value = String(state.settings.preferredAudioFormat || 'mp3');
    els.playlistFileTemplate.value = els.settingsPlaylistFileTemplate.value;
    els.playlistFolderTemplate.value = els.settingsPlaylistFolderTemplate.value;
    els.extractFormat.value = String(state.settings.preferredAudioFormat || 'mp3');
    els.compressorExtension.value = String(state.settings.compressorExtension || 'unchanged');
    els.compressorEncoder.value = String(state.settings.compressorEncoder || 'x264');
    els.compressorSpeed.value = String(state.settings.compressorSpeed || 'medium');
    els.compressorQuality.value = String(state.settings.compressorQuality || 23);
    els.compressorQualityValue.textContent = els.compressorQuality.value;
    els.compressorAudioFormat.value = String(state.settings.compressorAudioFormat || 'copy');
    els.compressorSuffix.value = String(state.settings.compressorSuffix || '_compressed');
    els.compressorSameFolder.checked = state.settings.compressorSameFolder !== false;
    state.compressorOutputDir = String(state.settings.compressorOutputDir || '');
    await refreshDependencyStatus();
    setPlaylistMode('playlist-video');
    applyTheme(state.settings.theme || localStorage.getItem('aurivoDawlodTheme') || localStorage.getItem('theme') || 'dark');

    els.minimizeBtn.addEventListener('click', () => electronApi?.minimizeWindow());
    els.maximizeBtn.addEventListener('click', () => electronApi?.maximizeWindow());
    els.closeBtn.addEventListener('click', () => electronApi?.closeWindow());
    els.analyzeBtn.addEventListener('click', analyze);
    els.urlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') analyze();
    });
    els.pasteBtn.addEventListener('click', async () => {
        const text = await api.readClipboard();
        if (text) els.urlInput.value = text;
    });
    els.chooseFolderBtn.addEventListener('click', async () => {
        const result = await api.chooseFolder();
        if (result?.downloadDir) {
            els.downloadPath.textContent = result.downloadDir;
            els.playlistDownloadPath.textContent = result.downloadDir;
            els.settingsDownloadPath.textContent = result.downloadDir;
        }
    });
    els.playlistChooseFolderBtn.addEventListener('click', async () => {
        const result = await api.chooseFolder();
        if (result?.downloadDir) {
            els.downloadPath.textContent = result.downloadDir;
            els.playlistDownloadPath.textContent = result.downloadDir;
            els.settingsDownloadPath.textContent = result.downloadDir;
        }
    });
    els.settingsChooseFolderBtn.addEventListener('click', async () => {
        const result = await api.chooseFolder();
        if (result?.downloadDir) {
            els.downloadPath.textContent = result.downloadDir;
            els.playlistDownloadPath.textContent = result.downloadDir;
            els.settingsDownloadPath.textContent = result.downloadDir;
        }
    });
    els.settingsChooseConfigBtn.addEventListener('click', async () => {
        const result = await api.chooseConfigFile();
        if (result?.configPath) {
            els.settingsConfigPath.textContent = result.configPath;
            state.settings = { ...state.settings, configPath: result.configPath };
        }
    });
    els.settingsHomeBtn.addEventListener('click', () => switchPage('single'));
    els.settingsRestartBtn.addEventListener('click', () => window.aurivo?.app?.relaunch?.());
    els.prepareDependenciesBtn.addEventListener('click', prepareDependencies);
    els.downloadBtn.addEventListener('click', startDownload);
    els.extractBtn.addEventListener('click', startExtractDownload);
    els.errorDetailsBtn?.addEventListener('click', () => {
        els.errorDetailsBox?.classList.toggle('hidden');
        els.errorDetailsBtn?.classList.toggle('open', !els.errorDetailsBox?.classList.contains('hidden'));
    });
    els.hideMediaPanelBtn.addEventListener('click', () => {
        els.mediaPanel.classList.add('hidden');
        state.info = null;
    });
    els.moreOptionsBtn.addEventListener('click', () => {
        const advanced = document.querySelector('.advanced');
        if (advanced) advanced.open = !advanced.open;
    });
    els.playlistDownloadBtn.addEventListener('click', startPlaylistDownload);
    els.playlistAudioDownloadBtn.addEventListener('click', () => startPlaylistModeDownload('playlist-audio'));
    els.playlistThumbnailsBtn.addEventListener('click', () => startPlaylistModeDownload('playlist-thumbnails'));
    els.playlistLinksBtn.addEventListener('click', () => startPlaylistModeDownload('playlist-links'));
    els.playlistPasteBtn.addEventListener('click', async () => {
        const text = await api.readClipboard();
        if (text) els.playlistUrl.value = text;
    });
    els.playlistVideoToggle.addEventListener('click', () => setPlaylistMode('playlist-video'));
    els.playlistAudioToggle.addEventListener('click', () => setPlaylistMode('playlist-audio'));
    els.workspaceTabs.forEach((tab) => {
        tab.addEventListener('click', () => switchPage(tab.dataset.page));
    });
    els.menuBtn.addEventListener('click', () => {
        setMenuOpen(els.appMenu.classList.contains('hidden'));
    });
    els.menuItems.forEach((item) => {
        item.addEventListener('click', () => {
            const page = item.dataset.menuPage;
            if (page === 'about') {
                setStatus('idle', 'Aurivo-Dawlod', dlt('status.aboutDetail'));
                setMenuOpen(false);
                return;
            }
            if (page === 'compressor') {
                setStatus('idle', dlt('compressor.title'), dlt('status.compressorReady'));
            }
            switchPage(page);
        });
    });
    els.themeSelect.addEventListener('change', () => saveThemeSetting(els.themeSelect.value));
    els.settingsVideoQuality.addEventListener('change', savePreferenceSettings);
    els.settingsVideoCodec.addEventListener('change', savePreferenceSettings);
    els.settingsAudioFormat.addEventListener('change', async () => {
        await savePreferenceSettings();
        els.playlistAudioFormat.value = els.settingsAudioFormat.value;
        els.extractFormat.value = els.settingsAudioFormat.value;
    });
    els.customArgs.addEventListener('change', async () => {
        state.settings = await api.saveSettings({ customArgs: els.customArgs.value });
    });
    els.closeOnFinish.addEventListener('change', async () => {
        state.settings = await api.saveSettings({ closeOnFinish: els.closeOnFinish.checked });
    });
    els.settingsBrowserCookies.addEventListener('change', savePreferenceSettings);
    els.settingsProxy.addEventListener('change', savePreferenceSettings);
    els.settingsCustomArgs.addEventListener('change', async () => {
        await savePreferenceSettings();
        els.customArgs.value = els.settingsCustomArgs.value;
    });
    els.settingsUseConfigFile.addEventListener('change', savePreferenceSettings);
    els.settingsShowMoreFormats.addEventListener('change', savePreferenceSettings);
    els.settingsMaxDownloads.addEventListener('change', savePreferenceSettings);
    els.settingsPlaylistFileTemplate.addEventListener('change', async () => {
        await savePreferenceSettings();
        els.playlistFileTemplate.value = els.settingsPlaylistFileTemplate.value;
    });
    els.settingsPlaylistFolderTemplate.addEventListener('change', async () => {
        await savePreferenceSettings();
        els.playlistFolderTemplate.value = els.settingsPlaylistFolderTemplate.value;
    });
    els.resetPlaylistFileTemplateBtn.addEventListener('click', async () => {
        els.settingsPlaylistFileTemplate.value = '%(playlist_index)s.%(title)s.%(ext)s';
        await savePreferenceSettings();
        els.playlistFileTemplate.value = els.settingsPlaylistFileTemplate.value;
    });
    els.resetPlaylistFolderTemplateBtn.addEventListener('click', async () => {
        els.settingsPlaylistFolderTemplate.value = '%(playlist_title)s';
        await savePreferenceSettings();
        els.playlistFolderTemplate.value = els.settingsPlaylistFolderTemplate.value;
    });
    els.settingsCloseToTray.addEventListener('change', savePreferenceSettings);
    els.settingsDisableAutoUpdates.addEventListener('change', savePreferenceSettings);
    els.refreshHistoryBtn.addEventListener('click', loadHistory);
    els.historySearch.addEventListener('input', renderHistory);
    els.historyFormatFilter.addEventListener('change', renderHistory);
    els.historyStatusFilter.addEventListener('change', renderHistory);
    els.exportHistoryJsonBtn.addEventListener('click', async () => {
        const result = await api.exportHistory('json');
        if (result?.filePath) setStatus('idle', dlt('history.exported'), result.filePath);
    });
    els.exportHistoryCsvBtn.addEventListener('click', async () => {
        const result = await api.exportHistory('csv');
        if (result?.filePath) setStatus('idle', dlt('history.exported'), result.filePath);
    });
    els.clearHistoryBtn.addEventListener('click', async () => {
        await api.clearHistory();
        await loadHistory();
    });
    els.clearDoneBtn.addEventListener('click', () => {
        for (const [id, row] of state.jobs.entries()) {
            if (row.classList.contains('done') || row.classList.contains('error') || row.classList.contains('cancelled')) {
                row.remove();
                state.jobs.delete(id);
            }
        }
        syncJobsPanel();
    });
    els.compressorFileInput.addEventListener('change', async () => {
        await addCompressorFiles(els.compressorFileInput.files);
        els.compressorFileInput.value = '';
    });
    els.compressorDropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        els.compressorDropZone.classList.add('dragging');
    });
    els.compressorDropZone.addEventListener('dragleave', () => {
        els.compressorDropZone.classList.remove('dragging');
    });
    els.compressorDropZone.addEventListener('drop', async (event) => {
        event.preventDefault();
        els.compressorDropZone.classList.remove('dragging');
        await addCompressorFiles(event.dataTransfer?.files);
    });
    els.compressorQuality.addEventListener('input', () => {
        els.compressorQualityValue.textContent = els.compressorQuality.value;
    });
    [
        els.compressorExtension,
        els.compressorEncoder,
        els.compressorSpeed,
        els.compressorAudioFormat,
        els.compressorSuffix
    ].forEach((control) => control.addEventListener('change', saveCompressorSettings));
    els.compressorQuality.addEventListener('change', saveCompressorSettings);
    els.compressorSameFolder.addEventListener('change', async () => {
        syncCompressorOutputState();
        await saveCompressorSettings();
    });
    els.compressorChooseOutputBtn.addEventListener('click', async () => {
        const result = await api.chooseOutputFolder();
        if (result?.folder) {
            state.compressorOutputDir = result.folder;
            syncCompressorOutputState();
            await saveCompressorSettings();
        }
    });
    els.compressorClearFilesBtn.addEventListener('click', () => {
        state.compressorFiles = [];
        renderCompressorFiles();
    });
    els.compressorStartBtn.addEventListener('click', startCompression);
    els.compressorCancelBtn.addEventListener('click', async () => {
        if (!state.compressorBatchId) return;
        await api.cancelCompression(state.compressorBatchId);
        state.compressorBatchId = '';
        els.compressorStartBtn.disabled = false;
        els.compressorCancelBtn.disabled = true;
        setStatus('idle', dlt('status.compressCancelled'), dlt('status.compressCancelledDetail'));
    });
    renderCompressorFiles();
    syncCompressorOutputState();
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            state.mode = tab.dataset.mode;
            renderMode();
        });
    });
    api.onJobUpdate(enqueueJobUpdate);
    api.onLoadUrl?.((payload) => {
        if (!/^https?:\/\//i.test(String(payload?.url || '').trim())) {
            showNoUrlNotice(payload?.error);
            return;
        }
        analyzeUrl(payload.url).catch((error) => {
            setStatus('error', dlt('error.analysisFailed'), String(error?.message || error || dlt('common.unknownError')));
        });
    });
    const pendingUrl = await api.getPendingUrl?.();
    if (pendingUrl) {
        analyzeUrl(pendingUrl).catch((error) => {
            setStatus('error', dlt('error.analysisFailed'), String(error?.message || error || dlt('common.unknownError')));
        });
    }
    const pendingNotice = await api.getPendingNotice?.();
    if (pendingNotice) {
        showNoUrlNotice(pendingNotice.error);
    }
}

init();
