; Aurivo custom NSIS hooks (electron-builder)
; - Multi-language welcome messaging (TR/EN/AR)
; - SmartScreen guidance (cannot be fully eliminated without code signing)

!ifndef BUILD_UNINSTALLER

; Localized strings
LangString AurivoWelcomeTitle 1033 "Welcome to Aurivo Media Player Setup"
LangString AurivoWelcomeTitle 1055 "Aurivo Medya Player Kurulumu'na Hoş Geldiniz"
LangString AurivoWelcomeTitle 1025 "مرحبا بك في برنامج تثبيت Aurivo Media Player"

LangString AurivoWelcomeText 1033 "This installer will guide you through the installation.$\r$\n$\r$\nIf Windows shows a SmartScreen warning for an unknown app, click 'More info' and then 'Run anyway'.$\r$\n$\r$\nOfficial downloads: GitHub Releases."
LangString AurivoWelcomeText 1055 "Bu kurulum sihirbazi yukleme adimlarinda size rehberlik eder.$\r$\n$\r$\nWindows bazen taninmayan uygulama icin SmartScreen uyarisi gosterebilir: 'Ek bilgi' > 'Yine de calistir'.$\r$\n$\r$\nResmi indirme: GitHub Releases."
LangString AurivoWelcomeText 1025 "سيرشدك هذا المُثبّت خلال عملية التثبيت.$\r$\n$\r$\nقد يعرض Windows تحذير SmartScreen لتطبيق غير معروف: اضغط 'مزيد من المعلومات' ثم 'تشغيل على أي حال'.$\r$\n$\r$\nالتنزيلات الرسمية: GitHub Releases."

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(AurivoWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(AurivoWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!endif
