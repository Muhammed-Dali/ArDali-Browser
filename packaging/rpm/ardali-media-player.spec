Name:           ardali-media-player
Version:        0.0.0
Release:        1%{?dist}
Summary:        ArDali Media Player (Electron)

License:        MIT
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
* Tue Feb 17 2026 ArDali <support@ardali.app> - 0.0.0-1
- Initial spec template

