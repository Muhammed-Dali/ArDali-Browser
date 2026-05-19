; ArDali custom NSIS hooks (electron-builder)
; - Multi-language welcome messaging (TR/EN/AR)
; - SmartScreen guidance (cannot be fully eliminated without code signing)

!ifndef BUILD_UNINSTALLER

; Localized strings
LangString ArDaliWelcomeTitle 1033 "Welcome to ArDali Media Player Setup"
LangString ArDaliWelcomeTitle 1055 "ArDali Medya Player Kurulumu'na Hoş Geldiniz"
LangString ArDaliWelcomeTitle 1025 "مرحبا بك في برنامج تثبيت ArDali Media Player"

LangString ArDaliWelcomeText 1033 "This installer will guide you through the installation.$\r$\n$\r$\nIf Windows shows a SmartScreen warning for an unknown app, click 'More info' and then 'Run anyway'.$\r$\n$\r$\nOfficial downloads: GitHub Releases."
LangString ArDaliWelcomeText 1055 "Bu kurulum sihirbazi yukleme adimlarinda size rehberlik eder.$\r$\n$\r$\nWindows bazen taninmayan uygulama icin SmartScreen uyarisi gosterebilir: 'Ek bilgi' > 'Yine de calistir'.$\r$\n$\r$\nResmi indirme: GitHub Releases."
LangString ArDaliWelcomeText 1025 "سيرشدك هذا المُثبّت خلال عملية التثبيت.$\r$\n$\r$\nقد يعرض Windows تحذير SmartScreen لتطبيق غير معروف: اضغط 'مزيد من المعلومات' ثم 'تشغيل على أي حال'.$\r$\n$\r$\nالتنزيلات الرسمية: GitHub Releases."

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(ArDaliWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(ArDaliWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!endif
