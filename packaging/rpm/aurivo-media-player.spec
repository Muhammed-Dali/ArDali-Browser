Name:           aurivo-media-player
Version:        0.0.0
Release:        1%{?dist}
Summary:        Aurivo Media Player (Electron)

License:        MIT
URL:            https://aurivo.app
Source0:        %{name}-%{version}.AppImage

BuildArch:      x86_64

%description
Aurivo Media Player; Electron tabanlı gelişmiş bir medya oynatıcıdır.

Bu spec dosyası, release AppImage'ini /opt altına kurmak için referans amaçlıdır.
Resmi rpm çıktısı CI'da electron-builder ile üretilir.

%prep

%build

%install
mkdir -p %{buildroot}/opt/aurivo
install -m 0755 %{SOURCE0} %{buildroot}/opt/aurivo/aurivo.AppImage
mkdir -p %{buildroot}/usr/bin
ln -sf /opt/aurivo/aurivo.AppImage %{buildroot}/usr/bin/aurivo

%files
/opt/aurivo/aurivo.AppImage
/usr/bin/aurivo

%changelog
* Tue Feb 17 2026 Aurivo <support@aurivo.app> - 0.0.0-1
- Initial spec template

