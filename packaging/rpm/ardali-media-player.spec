Name:           ardali-media-player
Version:        5.4.3
Release:        1%{?dist}
Summary:        ArDali Media Player (Electron)

License:        GPL-3.0-only
URL:            https://ardali.app
Source0:        %{name}-%{version}.AppImage

BuildArch:      x86_64

%description
ArDali Media Player; Electron tabanlı gelişmiş bir medya oynatıcıdır.

Bu spec dosyası, release AppImage'ini /opt altına kurmak için referans amaçlıdır.
Resmi rpm çıktısı CI'da electron-builder ile üretilir.

%prep

%build

%install
mkdir -p %{buildroot}/opt/ardali
install -m 0755 %{SOURCE0} %{buildroot}/opt/ardali/ardali.AppImage
mkdir -p %{buildroot}/usr/bin
ln -sf /opt/ardali/ardali.AppImage %{buildroot}/usr/bin/ardali

%files
/opt/ardali/ardali.AppImage
/usr/bin/ardali

%changelog
* Wed Jul 22 2026 ArDali <support@ardali.app> - 5.4.3-1
- Fix packaged Web DALI startup and new-tab customization reliability

* Wed Jul 22 2026 ArDali <support@ardali.app> - 5.4.2-1
- Update fast-uri to 3.1.4 for the release security gate

* Wed Jul 22 2026 ArDali <support@ardali.app> - 5.4.1-1
- Faster lazy-loaded Audio Effects startup and owned ProjectM window integration

* Tue Jul 21 2026 ArDali <support@ardali.app> - 5.4.0-1
- Localized Password Manager, Electron security hardening and gated release pipeline

* Wed Jul 15 2026 ArDali <support@ardali.app> - 5.3.0-1
- Smart sidebar, browser workflow, localization, performance and web protection update

* Tue Jul 14 2026 ArDali <support@ardali.app> - 5.2.17-1
- CI/CD and Linux package publishing reliability update

* Tue Jul 14 2026 ArDali <support@ardali.app> - 5.2.16-1
- Release metadata and packaging consistency update

* Mon Jul 13 2026 ArDali <support@ardali.app> - 5.2.13-1
- Initial spec template
