Name:           ardali-media-player
Version:        5.2.16
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
* Tue Jul 14 2026 ArDali <support@ardali.app> - 5.2.16-1
- Release metadata and packaging consistency update

* Mon Jul 13 2026 ArDali <support@ardali.app> - 5.2.13-1
- Initial spec template
