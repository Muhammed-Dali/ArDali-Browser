use adw::prelude::*;
use chrono::Local;
use gettextrs::gettext;
use log::{debug, error, info, trace};
#[cfg(feature = "mpris")]
use mpris_player::PlaybackStatus;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use crate::core::logging::Logging;
use crate::core::microphone_thread::microphone_thread;
use crate::core::recognition::{launch_recognition_pipeline, RecognitionEngineMode};
use crate::core::thread_messages::{GUIMessage::*, *};

use crate::gui::song_history_interface::FavoritesInterface;

use crate::gui::song_history_interface::{RecognitionHistoryInterface, SongRecordInterface};
#[cfg(target_os = "linux")]
use crate::plugins::ksni::SystrayInterface;
#[cfg(feature = "mpris")]
use crate::plugins::mpris_player::{get_player, update_song};
use crate::utils::csv_song_history::SongHistoryRecord;
use crate::utils::filesystem_operations::{
    clear_cache, obtain_favorites_csv_path, obtain_recognition_history_csv_path,
};

use crate::gui::preferences::{Preferences, PreferencesInterface};

use crate::gui::context_menu::ContextMenuUtil;
use crate::gui::history_entry::HistoryEntry;
use crate::gui::listed_device::ListedDevice;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Copy)]
struct PulseUiStrings {
    recognize_songs: &'static str,
    recognize_from_file: &'static str,
    pick_file: &'static str,
    recognize_from_microphone: &'static str,
    recognize_from_speakers: &'static str,
    quick_device_selection: &'static str,
    quick_device_headphones: &'static str,
    quick_device_headphones_mic: &'static str,
    recognition_result: &'static str,
    search_on_youtube: &'static str,
    search_button: &'static str,
    audio_input: &'static str,
    device: &'static str,
    volume: &'static str,
    recognition_history: &'static str,
    history_song_name: &'static str,
    history_album: &'static str,
    history_date: &'static str,
    favorites_title: &'static str,
    view_favorites: &'static str,
    app_menu: &'static str,
    show_notifications: &'static str,
    about: &'static str,
    history_options: &'static str,
    export_to_csv: &'static str,
    delete_history: &'static str,
    copy_artist_track: &'static str,
    copy_artist: &'static str,
    copy_track_name: &'static str,
    copy_album: &'static str,
    delete_from_history: &'static str,
    add_to_favorites: &'static str,
    remove_from_favorites: &'static str,
    select_file_to_recognize: &'static str,
}

fn current_pulse_ui_lang() -> String {
    let candidates = [
        std::env::var("AURIVO_LANG").ok(),
        std::env::var("LC_ALL").ok(),
        std::env::var("LANG").ok(),
        std::env::var("LANGUAGE").ok(),
    ];
    for raw in candidates.iter().flatten() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let first = trimmed.split(':').next().unwrap_or(trimmed);
        let normalized = first.replace('_', "-").to_lowercase();
        if !normalized.is_empty() {
            return normalized;
        }
    }
    "en-us".to_string()
}

fn pulse_app_id() -> String {
    let env_id = std::env::var("AURIVO_APP_ID").unwrap_or_default();
    let normalized = env_id.trim().to_string();
    if !normalized.is_empty() {
        return normalized;
    }
    "aurivo-media-player".to_string()
}

fn compact_text(input: &str, max_chars: usize) -> String {
    let text = input.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let clipped: String = text.chars().take(max_chars).collect();
    format!("{}...", clipped.trim())
}

fn extract_secondary_candidate_from_shazam(
    shazam_json: &str,
    primary_track_key: &str,
) -> Option<String> {
    let parsed: Value = serde_json::from_str(shazam_json).ok()?;
    let matches = parsed.get("matches")?.as_array()?;
    for entry in matches {
        let track = entry.get("track")?;
        let track_key = track
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if !primary_track_key.trim().is_empty() && track_key == primary_track_key.trim() {
            continue;
        }

        let title = track
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let artist = track
            .get("subtitle")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if title.is_empty() && artist.is_empty() {
            continue;
        }

        let label = if !artist.is_empty() && !title.is_empty() {
            format!("{} - {}", artist, title)
        } else if !artist.is_empty() {
            artist.to_string()
        } else {
            title.to_string()
        };
        return Some(compact_text(&label, 72));
    }
    None
}

fn pulse_ui_strings() -> PulseUiStrings {
    let lang = current_pulse_ui_lang();
    if lang.starts_with("tr") {
        PulseUiStrings {
            recognize_songs: "Sarki tani",
            recognize_from_file: "Dosyadan tani",
            pick_file: "Dosya sec...",
            recognize_from_microphone: "Mikrofondan tani",
            recognize_from_speakers: "Hoparlorden tani",
            quick_device_selection: "Hizli cihaz secimi",
            quick_device_headphones: "Kulaklik",
            quick_device_headphones_mic: "Kulaklik Mikrofon",
            recognition_result: "Tanima sonucu",
            search_on_youtube: "YouTube'da ara",
            search_button: "Ara...",
            audio_input: "Ses girisi",
            device: "Cihaz",
            volume: "Ses:",
            recognition_history: "Tanima gecmisi",
            history_song_name: "Sarki adi",
            history_album: "Album",
            history_date: "Taninma tarihi",
            favorites_title: "Favoriler",
            view_favorites: "Favorileri goruntule",
            app_menu: "Uygulama menusu",
            show_notifications: "Bildirimleri goster",
            about: "Hakkinda...",
            history_options: "Gecmis secenekleri...",
            export_to_csv: "CSV olarak disa aktar",
            delete_history: "Gecmisi sil",
            copy_artist_track: "Sanatci ve sarkiyi kopyala",
            copy_artist: "Sanatciyi kopyala",
            copy_track_name: "Sarki adini kopyala",
            copy_album: "Albumu kopyala",
            delete_from_history: "Gecmisten sil",
            add_to_favorites: "Favorilere ekle",
            remove_from_favorites: "Favorilerden kaldir",
            select_file_to_recognize: "Tanimak icin bir dosya sec",
        }
    } else if lang.starts_with("ar") {
        PulseUiStrings {
            recognize_songs: "التعرف على الاغاني",
            recognize_from_file: "تعرف من ملف",
            pick_file: "اختر ملفا...",
            recognize_from_microphone: "تعرف من الميكروفون",
            recognize_from_speakers: "تعرف من السماعات",
            quick_device_selection: "اختيار سريع للجهاز",
            quick_device_headphones: "سماعة",
            quick_device_headphones_mic: "ميكروفون السماعة",
            recognition_result: "نتيجة التعرف",
            search_on_youtube: "ابحث في يوتيوب",
            search_button: "بحث...",
            audio_input: "ادخال الصوت",
            device: "الجهاز",
            volume: "الصوت:",
            recognition_history: "سجل التعرف",
            history_song_name: "اسم الاغنية",
            history_album: "الالبوم",
            history_date: "تاريخ التعرف",
            favorites_title: "المفضلة",
            view_favorites: "عرض المفضلة",
            app_menu: "قائمة التطبيق",
            show_notifications: "اظهار الاشعارات",
            about: "حول...",
            history_options: "خيارات السجل...",
            export_to_csv: "تصدير CSV",
            delete_history: "حذف السجل",
            copy_artist_track: "نسخ الفنان والاغنية",
            copy_artist: "نسخ الفنان",
            copy_track_name: "نسخ اسم الاغنية",
            copy_album: "نسخ الالبوم",
            delete_from_history: "حذف من السجل",
            add_to_favorites: "اضافة الى المفضلة",
            remove_from_favorites: "ازالة من المفضلة",
            select_file_to_recognize: "اختر ملفا للتعرف عليه",
        }
    } else if lang.starts_with("fr") {
        PulseUiStrings {
            recognize_songs: "Reconnaissance des morceaux",
            recognize_from_file: "Reconnaitre depuis un fichier",
            pick_file: "Choisir un fichier...",
            recognize_from_microphone: "Reconnaitre depuis le micro",
            recognize_from_speakers: "Reconnaitre depuis les haut-parleurs",
            quick_device_selection: "Selection rapide du peripherique",
            quick_device_headphones: "Casque",
            quick_device_headphones_mic: "Micro du casque",
            recognition_result: "Resultat de reconnaissance",
            search_on_youtube: "Rechercher sur YouTube",
            search_button: "Rechercher...",
            audio_input: "Entree audio",
            device: "Peripherique",
            volume: "Volume :",
            recognition_history: "Historique de reconnaissance",
            history_song_name: "Titre",
            history_album: "Album",
            history_date: "Date de reconnaissance",
            favorites_title: "Favoris",
            view_favorites: "Voir les favoris",
            app_menu: "Menu de l'application",
            show_notifications: "Afficher les notifications",
            about: "A propos...",
            history_options: "Options de l'historique...",
            export_to_csv: "Exporter en CSV",
            delete_history: "Supprimer l'historique",
            copy_artist_track: "Copier artiste et titre",
            copy_artist: "Copier l'artiste",
            copy_track_name: "Copier le titre",
            copy_album: "Copier l'album",
            delete_from_history: "Supprimer de l'historique",
            add_to_favorites: "Ajouter aux favoris",
            remove_from_favorites: "Retirer des favoris",
            select_file_to_recognize: "Choisir un fichier a reconnaitre",
        }
    } else if lang.starts_with("es") {
        PulseUiStrings {
            recognize_songs: "Reconocer canciones",
            recognize_from_file: "Reconocer desde archivo",
            pick_file: "Elegir archivo...",
            recognize_from_microphone: "Reconocer desde microfono",
            recognize_from_speakers: "Reconocer desde altavoces",
            quick_device_selection: "Seleccion rapida de dispositivo",
            quick_device_headphones: "Auriculares",
            quick_device_headphones_mic: "Microfono del auricular",
            recognition_result: "Resultado de reconocimiento",
            search_on_youtube: "Buscar en YouTube",
            search_button: "Buscar...",
            audio_input: "Entrada de audio",
            device: "Dispositivo",
            volume: "Volumen:",
            recognition_history: "Historial de reconocimiento",
            history_song_name: "Cancion",
            history_album: "Album",
            history_date: "Fecha de reconocimiento",
            favorites_title: "Favoritos",
            view_favorites: "Ver favoritos",
            app_menu: "Menu de la aplicacion",
            show_notifications: "Mostrar notificaciones",
            about: "Acerca de...",
            history_options: "Opciones del historial...",
            export_to_csv: "Exportar CSV",
            delete_history: "Eliminar historial",
            copy_artist_track: "Copiar artista y cancion",
            copy_artist: "Copiar artista",
            copy_track_name: "Copiar nombre de la cancion",
            copy_album: "Copiar album",
            delete_from_history: "Eliminar del historial",
            add_to_favorites: "Agregar a favoritos",
            remove_from_favorites: "Quitar de favoritos",
            select_file_to_recognize: "Selecciona un archivo para reconocer",
        }
    } else if lang.starts_with("zh") {
        PulseUiStrings {
            recognize_songs: "识别歌曲",
            recognize_from_file: "从文件识别",
            pick_file: "选择文件...",
            recognize_from_microphone: "从麦克风识别",
            recognize_from_speakers: "从扬声器识别",
            quick_device_selection: "快速设备选择",
            quick_device_headphones: "耳机",
            quick_device_headphones_mic: "耳机麦克风",
            recognition_result: "识别结果",
            search_on_youtube: "在 YouTube 搜索",
            search_button: "搜索...",
            audio_input: "音频输入",
            device: "设备",
            volume: "音量：",
            recognition_history: "识别历史",
            history_song_name: "歌曲名",
            history_album: "专辑",
            history_date: "识别日期",
            favorites_title: "收藏",
            view_favorites: "查看收藏",
            app_menu: "应用菜单",
            show_notifications: "显示通知",
            about: "关于...",
            history_options: "历史选项...",
            export_to_csv: "导出 CSV",
            delete_history: "删除历史",
            copy_artist_track: "复制歌手和歌曲",
            copy_artist: "复制歌手",
            copy_track_name: "复制歌曲名",
            copy_album: "复制专辑",
            delete_from_history: "从历史中删除",
            add_to_favorites: "添加到收藏",
            remove_from_favorites: "从收藏中移除",
            select_file_to_recognize: "选择要识别的文件",
        }
    } else {
        PulseUiStrings {
            recognize_songs: "Recognize songs",
            recognize_from_file: "Recognize from file",
            pick_file: "Pick a file...",
            recognize_from_microphone: "Recognize from microphone",
            recognize_from_speakers: "Recognize from my speakers",
            quick_device_selection: "Quick device selection",
            quick_device_headphones: "Headphones",
            quick_device_headphones_mic: "Headset microphone",
            recognition_result: "Recognition result",
            search_on_youtube: "Search on YouTube",
            search_button: "Search...",
            audio_input: "Audio input",
            device: "Device",
            volume: "Volume:",
            recognition_history: "Recognition history",
            history_song_name: "Song name",
            history_album: "Album",
            history_date: "Recognition date",
            favorites_title: "Favorites",
            view_favorites: "View favorites",
            app_menu: "Application menu",
            show_notifications: "Show notifications",
            about: "About...",
            history_options: "History options...",
            export_to_csv: "Export to CSV",
            delete_history: "Delete history",
            copy_artist_track: "Copy artist and track",
            copy_artist: "Copy artist",
            copy_track_name: "Copy track name",
            copy_album: "Copy album",
            delete_from_history: "Delete from history",
            add_to_favorites: "Add to favorites",
            remove_from_favorites: "Remove from favorites",
            select_file_to_recognize: "Select a file to recognize",
        }
    }
}

fn decode_cover_texture(cover_image: &[u8]) -> Option<gdk::Texture> {
    if let Ok(texture) = gdk::Texture::from_bytes(&glib::Bytes::from(cover_image)) {
        return Some(texture);
    }

    let loader = gdk_pixbuf::PixbufLoader::new();
    if loader.write(cover_image).is_err() {
        return None;
    }
    if loader.close().is_err() {
        return None;
    }
    loader
        .pixbuf()
        .map(|pixbuf| gdk::Texture::for_pixbuf(&pixbuf))
}

fn is_quick_device_candidate(device: &DeviceListItem) -> bool {
    let haystack = format!("{} {}", device.display_name, device.inner_name).to_lowercase();
    haystack.contains("usb")
        || haystack.contains("bluetooth")
        || haystack.contains("headset")
        || haystack.contains("headphone")
        || haystack.contains("earbud")
        || haystack.contains("pnp")
}

fn quick_device_label(device: &DeviceListItem, active: bool) -> String {
    let _ = active;
    let strings = pulse_ui_strings();
    if device.is_monitor {
        strings.quick_device_headphones.to_string()
    } else {
        strings.quick_device_headphones_mic.to_string()
    }
}

fn is_headphone_output_candidate(device: &DeviceListItem) -> bool {
    let haystack = format!("{} {}", device.display_name, device.inner_name).to_lowercase();
    device.is_monitor
        && (haystack.contains("usb")
            || haystack.contains("bluetooth")
            || haystack.contains("headset")
            || haystack.contains("headphone")
            || haystack.contains("earbud")
            || haystack.contains("pnp"))
}

fn device_indicator_markup(active: bool) -> String {
    if active {
        "<span foreground=\"#49a8ff\" size=\"large\">◉</span>".to_string()
    } else {
        "<span foreground=\"#8b93a6\" size=\"large\">◯</span>".to_string()
    }
}

fn restart_recording_if_needed(
    recording_target: &Rc<RefCell<Option<(String, bool)>>>,
    microphone_tx: &async_channel::Sender<MicrophoneMessage>,
    device_name: &str,
    is_monitor: bool,
) {
    let same_target = recording_target
        .borrow()
        .as_ref()
        .map(|(current_name, current_monitor)| {
            current_name == device_name && *current_monitor == is_monitor
        })
        .unwrap_or(false);
    if same_target {
        return;
    }

    let _ = microphone_tx.try_send(MicrophoneMessage::MicrophoneRecordStop);
    let _ = microphone_tx.try_send(MicrophoneMessage::MicrophoneRecordStart(
        device_name.to_owned(),
    ));
    *recording_target.borrow_mut() = Some((device_name.to_owned(), is_monitor));
}

fn stop_recording_if_needed(
    recording_target: &Rc<RefCell<Option<(String, bool)>>>,
    microphone_tx: &async_channel::Sender<MicrophoneMessage>,
) {
    if recording_target.borrow().is_none() {
        return;
    }

    let _ = microphone_tx.try_send(MicrophoneMessage::MicrophoneRecordStop);
    *recording_target.borrow_mut() = None;
}

fn apply_adaptive_window_layout(
    window: &adw::ApplicationWindow,
    results_section: &adw::PreferencesGroup,
    show_results: bool,
) {
    let was_visible = results_section.is_visible();
    results_section.set_visible(show_results);

    if show_results {
        if !was_visible {
            window.set_default_size(1240, 820);
            window.present();
        }
    } else {
        if was_visible {
            window.set_default_size(1080, 760);
            window.present();
        }
    }
}

fn update_acoustid_status_ui(builder: &gtk::Builder) {
    let status_row: adw::ActionRow = match builder.object("acoustid_status_row") {
        Some(row) => row,
        None => return,
    };
    let engine_row: adw::ComboRow = match builder.object("recognition_engine_setting") {
        Some(row) => row,
        None => return,
    };
    let api_key_row: adw::EntryRow = match builder.object("acoustid_api_key_setting") {
        Some(row) => row,
        None => return,
    };

    let mode = match engine_row.selected() {
        1 => RecognitionEngineMode::SongRecOnly,
        2 => RecognitionEngineMode::AcoustIdOnly,
        _ => RecognitionEngineMode::Hybrid,
    };
    let has_key = !api_key_row.text().trim().is_empty();
    let subtitle = match mode {
        RecognitionEngineMode::SongRecOnly => "SongRec only aktif. AcoustID devre disi.",
        RecognitionEngineMode::Hybrid if has_key => {
            "Hybrid aktif. AcoustID fallback hazir (API key var)."
        }
        RecognitionEngineMode::Hybrid => "Hybrid aktif. AcoustID fallback icin API key gerekli.",
        RecognitionEngineMode::AcoustIdOnly if has_key => {
            "AcoustID only aktif. Tanima AcoustID ile yapilacak."
        }
        RecognitionEngineMode::AcoustIdOnly => {
            "AcoustID only secili ama API key eksik. Tanima calismayabilir."
        }
    };

    status_row.set_subtitle(subtitle);
}

fn update_benchmark_rows(
    summary_row: &adw::ActionRow,
    engine_row: &adw::ActionRow,
    latency_row: &adw::ActionRow,
    last_row: &adw::ActionRow,
    snapshot: &RecognitionBenchmarkSnapshot,
) {
    let success_rate = if snapshot.attempts_total > 0 {
        (snapshot.success_total as f64 / snapshot.attempts_total as f64) * 100.0
    } else {
        0.0
    };
    summary_row.set_subtitle(&format!(
        "Attempts: {} | Success: {} ({:.1}%)",
        snapshot.attempts_total, snapshot.success_total, success_rate
    ));
    engine_row.set_subtitle(&format!(
        "SongRec: {} | AcoustID: {}",
        snapshot.songrec_success, snapshot.acoustid_success
    ));
    latency_row.set_subtitle(&format!(
        "Avg: {} ms | Last: {} ms",
        snapshot.avg_latency_ms, snapshot.last_latency_ms
    ));
    let engine = if snapshot.last_engine.is_empty() {
        "-"
    } else {
        snapshot.last_engine.as_str()
    };
    let outcome = if snapshot.last_outcome.is_empty() {
        "-"
    } else {
        snapshot.last_outcome.as_str()
    };
    last_row.set_subtitle(&format!("Engine: {} | Outcome: {}", engine, outcome));
}

pub fn gui_main(
    log_object: Logging,
    recording: bool,
    input_file: Option<String>,
    enable_mpris_cli: bool,
) -> Result<(), Box<dyn Error>> {
    let app = App::new(log_object);
    app.run(recording, enable_mpris_cli, input_file);

    Ok(())
}

struct App {
    builder: gtk::Builder,

    preferences_interface: Arc<Mutex<PreferencesInterface>>,
    song_history_interface: Rc<RefCell<RecognitionHistoryInterface>>,
    favorites_interface: Rc<RefCell<FavoritesInterface>>,
    old_preferences: Preferences,

    ctx_selected_item: Rc<RefCell<Option<HistoryEntry>>>,
    ctx_buffered_log: Rc<RefCell<String>>,
    #[cfg(target_os = "linux")]
    ctx_systray_handle: Rc<RefCell<Option<ksni::Handle<SystrayInterface>>>>,
    ctx_logger_source_id: Rc<RefCell<Option<glib::source::SourceId>>>,

    gui_tx: async_channel::Sender<GUIMessage>,
    gui_rx: async_channel::Receiver<GUIMessage>,
    microphone_tx: async_channel::Sender<MicrophoneMessage>,
    microphone_rx: async_channel::Receiver<MicrophoneMessage>,
    processing_tx: async_channel::Sender<ProcessingMessage>,
    processing_rx: async_channel::Receiver<ProcessingMessage>,
    http_tx: async_channel::Sender<HTTPMessage>,
    http_rx: async_channel::Receiver<HTTPMessage>,
}

// #[gtk::template_callbacks(functions)]
impl App {
    fn apply_runtime_localization(builder: &gtk::Builder) {
        let strings = pulse_ui_strings();

        let identify_section: adw::PreferencesGroup = builder.object("identify_section").unwrap();
        identify_section.set_title(strings.recognize_songs);

        let recognize_file_row: adw::ActionRow = builder.object("recognize_file_row").unwrap();
        recognize_file_row.set_title(strings.recognize_from_file);

        let recognize_file_button: gtk::Button = builder.object("recognize_file_button").unwrap();
        if let Some(child) = recognize_file_button.child() {
            if let Ok(content) = child.downcast::<adw::ButtonContent>() {
                content.set_label(strings.pick_file);
            }
        }

        let microphone_switch: adw::SwitchRow = builder.object("microphone_switch").unwrap();
        microphone_switch.set_title(strings.recognize_from_microphone);

        let loopback_switch: adw::SwitchRow = builder.object("loopback_switch").unwrap();
        loopback_switch.set_title(strings.recognize_from_speakers);

        let quick_device_section: adw::PreferencesGroup =
            builder.object("quick_device_section").unwrap();
        quick_device_section.set_title(strings.quick_device_selection);

        let results_section: adw::PreferencesGroup = builder.object("results_section").unwrap();
        results_section.set_title(strings.recognition_result);

        let search_youtube_row: adw::ActionRow = builder.object("search_youtube_row").unwrap();
        search_youtube_row.set_title(strings.search_on_youtube);

        let search_youtube_button: gtk::Button = builder.object("search_youtube_button").unwrap();
        if let Some(child) = search_youtube_button.child() {
            if let Ok(content) = child.downcast::<adw::ButtonContent>() {
                content.set_label(strings.search_button);
            }
        }

        let input_device_section: adw::PreferencesGroup =
            builder.object("input_device_section").unwrap();
        input_device_section.set_title(strings.audio_input);

        let audio_inputs: adw::ComboRow = builder.object("audio_inputs").unwrap();
        audio_inputs.set_title(strings.device);

        let volume_label: gtk::Label = builder.object("volume_label").unwrap();
        volume_label.set_label(strings.volume);

        let history_section: adw::PreferencesGroup = builder.object("history_section").unwrap();
        history_section.set_title(strings.recognition_history);

        let history_params: gtk::MenuButton = builder.object("history_params").unwrap();
        history_params.set_tooltip_text(Some(strings.history_options));

        let history_song_column: gtk::ColumnViewColumn =
            builder.object("history_song_column").unwrap();
        history_song_column.set_title(Some(strings.history_song_name));

        let history_album_column: gtk::ColumnViewColumn =
            builder.object("history_album_column").unwrap();
        history_album_column.set_title(Some(strings.history_album));

        let history_date_column: gtk::ColumnViewColumn =
            builder.object("history_date_column").unwrap();
        history_date_column.set_title(Some(strings.history_date));

        let favorites_page: adw::NavigationPage = builder.object("favorites_page").unwrap();
        favorites_page.set_title(strings.favorites_title);

        let favorites_song_column: gtk::ColumnViewColumn =
            builder.object("favorites_song_column").unwrap();
        favorites_song_column.set_title(Some(strings.history_song_name));

        let favorites_album_column: gtk::ColumnViewColumn =
            builder.object("favorites_album_column").unwrap();
        favorites_album_column.set_title(Some(strings.history_album));

        let favorites_date_column: gtk::ColumnViewColumn =
            builder.object("favorites_date_column").unwrap();
        favorites_date_column.set_title(Some(strings.history_date));

        let favorites_button: adw::PreferencesRow = builder.object("favorites_button").unwrap();
        if let Some(child) = favorites_button.child() {
            if let Ok(label) = child.downcast::<gtk::Label>() {
                label.set_label(strings.view_favorites);
            }
        }

        let favorites_export_content: adw::ButtonContent =
            builder.object("favorites_export_content").unwrap();
        favorites_export_content.set_label(strings.export_to_csv);

        let menu_button: gtk::MenuButton = builder.object("menu_button").unwrap();
        menu_button.set_tooltip_text(Some(strings.app_menu));

        let main_menu_model: gio::Menu = builder.object("main_menu_model").unwrap();
        main_menu_model.remove_all();
        main_menu_model.append(Some(strings.show_notifications), Some("win.notification-setting"));
        main_menu_model.append(Some(strings.about), Some("win.show-about"));

        let history_menu_model: gio::Menu = builder.object("history_menu_model").unwrap();
        history_menu_model.remove_all();
        history_menu_model.append(Some(strings.export_to_csv), Some("win.export-to-csv"));
        history_menu_model.append(Some(strings.delete_history), Some("win.wipe-history"));

        let history_context_model: gio::Menu = builder.object("history_context_model").unwrap();
        history_context_model.remove_all();
        let copy_section = gio::Menu::new();
        copy_section.append(Some(strings.copy_artist_track), Some("history-menu.copy-artist-track"));
        copy_section.append(Some(strings.copy_artist), Some("history-menu.copy-artist"));
        copy_section.append(Some(strings.copy_track_name), Some("history-menu.copy-track-name"));
        copy_section.append(Some(strings.copy_album), Some("history-menu.copy-album"));
        history_context_model.append_section(None, &copy_section);
        let search_section = gio::Menu::new();
        search_section.append(Some(strings.search_on_youtube), Some("history-menu.search-on-youtube"));
        history_context_model.append_section(None, &search_section);
        let action_section = gio::Menu::new();
        action_section.append(Some(strings.delete_from_history), Some("history-menu.remove-from-history"));
        action_section.append(Some(strings.add_to_favorites), Some("history-menu.add-to-favorites"));
        history_context_model.append_section(None, &action_section);

        let history_context_model_faved: gio::Menu =
            builder.object("history_context_model_faved").unwrap();
        history_context_model_faved.remove_all();
        let copy_section_faved = gio::Menu::new();
        copy_section_faved.append(Some(strings.copy_artist_track), Some("history-menu.copy-artist-track"));
        copy_section_faved.append(Some(strings.copy_artist), Some("history-menu.copy-artist"));
        copy_section_faved.append(Some(strings.copy_track_name), Some("history-menu.copy-track-name"));
        copy_section_faved.append(Some(strings.copy_album), Some("history-menu.copy-album"));
        history_context_model_faved.append_section(None, &copy_section_faved);
        let search_section_faved = gio::Menu::new();
        search_section_faved.append(Some(strings.search_on_youtube), Some("history-menu.search-on-youtube"));
        history_context_model_faved.append_section(None, &search_section_faved);
        let action_section_faved = gio::Menu::new();
        action_section_faved.append(Some(strings.remove_from_favorites), Some("history-menu.remove-from-favorites"));
        history_context_model_faved.append_section(None, &action_section_faved);

        let file_picker: gtk::FileDialog = builder.object("file_picker").unwrap();
        file_picker.set_title(strings.select_file_to_recognize);

        let about_dialog: adw::AboutDialog = builder.object("about_dialog").unwrap();
        about_dialog.set_application_name("Aurivo-Pulse");
        about_dialog.set_developer_name("Kodlayan Muhammet Dli");
        about_dialog.set_developers(&[
            "Muhammet Dli https://github.com/muhammed-aurivo-dev",
            "Aurivo Medya Player Linux https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux",
        ]);
        about_dialog.set_issue_url("https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux/issues");
        about_dialog.set_support_url("https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux");
        about_dialog.set_website("https://github.com/muhammed-aurivo-dev/Aurivo-Medya-Player-Linux");
        about_dialog.set_version("2.0.5");
    }

    fn try_open_search_inside_aurivo(query: &str, platform: &str) -> bool {
        let base = match std::env::var("AURIVO_PULSE_BRIDGE_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => return false,
        };

        let pref = utf8_percent_encode(platform, NON_ALPHANUMERIC).to_string();
        let encoded = utf8_percent_encode(query, NON_ALPHANUMERIC)
            .to_string()
            .replace("%20", "+");
        let mut target = base.clone();
        if target.contains('?') {
            target.push('&');
        } else {
            target.push('?');
        }
        target.push_str("query=");
        target.push_str(&encoded);
        target.push_str("&platform=");
        target.push_str(&pref);

        // Minimal HTTP GET to local Electron bridge.
        let raw = target.trim_start_matches("http://");
        let mut split = raw.splitn(2, '/');
        let host_port = split.next().unwrap_or("");
        let path_q = format!("/{}", split.next().unwrap_or(""));
        if host_port.is_empty() {
            return false;
        }
        let mut hp = host_port.splitn(2, ':');
        let host = hp.next().unwrap_or("127.0.0.1");
        let port = hp.next().and_then(|s| s.parse::<u16>().ok()).unwrap_or(80);
        let addr = format!("{}:{}", host, port);

        let mut stream = match TcpStream::connect(addr) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(600)));
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(600)));

        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            path_q, host_port
        );
        if stream.write_all(req.as_bytes()).is_err() {
            return false;
        }
        let mut buf = [0u8; 96];
        let n = stream.read(&mut buf).unwrap_or(0);
        if n == 0 {
            return false;
        }
        let head = String::from_utf8_lossy(&buf[..n]).to_string();
        head.contains(" 200 ") || head.contains(" 204 ")
    }

    fn new(log_object: Logging) -> App {
        let (gui_tx, gui_rx) = async_channel::unbounded();
        let (microphone_tx, microphone_rx) = async_channel::unbounded();
        let (processing_tx, processing_rx) = async_channel::unbounded();
        let (http_tx, http_rx) = async_channel::unbounded();

        log_object.connect_to_gui_logger(gui_tx.clone());

        glib::set_prgname(Some(match std::env::var("SNAP_NAME") {
            Ok(_) => "aurivo-media-player",
            _ => "aurivo-media-player",
        }));
        Self::load_resources();

        gtk::init().unwrap();

        if let Some(display) = gdk::Display::default() {
            let icon_theme = gtk::IconTheme::for_display(&display);
            icon_theme.add_resource_path("/com/aurivo/pulse/");
            let provider = gtk::CssProvider::new();
            provider.load_from_resource("/com/aurivo/pulse/style.css");
            gtk::style_context_add_provider_for_display(
                &display,
                &provider,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }

        let builder = gtk::Builder::new();

        let builder_scope = gtk::BuilderRustScope::new();
        // Self::add_callbacks_to_scope(&scope);
        builder.set_scope(Some(&builder_scope));

        Self::setup_callbacks(
            microphone_tx.clone(),
            gui_tx.clone(),
            builder.clone(),
            builder_scope,
        );
        builder
            .add_from_resource("/com/aurivo/pulse/interface.ui")
            .unwrap();
        Self::apply_runtime_localization(&builder);

        let history_list_store: gio::ListStore = builder.object("history_list_store").unwrap();
        let song_history_interface = Rc::new(RefCell::new(
            RecognitionHistoryInterface::new(
                history_list_store.clone(),
                obtain_recognition_history_csv_path,
            )
            .unwrap(),
        ));

        let history_selection: gtk::SingleSelection = builder.object("history_selection").unwrap();
        history_selection.set_model(Some(&history_list_store));

        let favorites_list_store: gio::ListStore = builder.object("favorites_list_store").unwrap();
        let favorites_interface = Rc::new(RefCell::new(
            FavoritesInterface::new(favorites_list_store.clone(), obtain_favorites_csv_path)
                .unwrap(),
        ));

        let favorites_selection: gtk::SingleSelection =
            builder.object("favorites_selection").unwrap();
        favorites_selection.set_model(Some(&favorites_list_store));

        let ctx_selected_item: Rc<RefCell<Option<HistoryEntry>>> = Rc::new(RefCell::new(None));
        let ctx_buffered_log: Rc<RefCell<String>> = Rc::new(RefCell::new(String::new()));
        let ctx_logger_source_id: Rc<RefCell<Option<glib::source::SourceId>>> =
            Rc::new(RefCell::new(None));

        let preferences_interface: PreferencesInterface = PreferencesInterface::new();
        let old_preferences: Preferences = preferences_interface.preferences.clone();
        let preferences_interface = Arc::new(Mutex::new(preferences_interface));

        let buffer_size_value: gtk::Adjustment = builder.object("buffer_size_value").unwrap();
        buffer_size_value.set_value(old_preferences.buffer_size_secs.unwrap() as f64);

        let request_interval_value: gtk::Adjustment = builder.object("interval_value").unwrap();
        request_interval_value.set_value(old_preferences.request_interval_secs_v3.unwrap() as f64);

        let recognition_engine_setting: adw::ComboRow =
            builder.object("recognition_engine_setting").unwrap();
        let recognition_mode = RecognitionEngineMode::from_preference_value(
            old_preferences.recognition_engine.as_deref(),
        );
        let recognition_index = match recognition_mode {
            RecognitionEngineMode::Hybrid => 0,
            RecognitionEngineMode::SongRecOnly => 1,
            RecognitionEngineMode::AcoustIdOnly => 2,
        };
        recognition_engine_setting.set_selected(recognition_index);

        let acoustid_api_key_setting: adw::EntryRow =
            builder.object("acoustid_api_key_setting").unwrap();
        acoustid_api_key_setting.set_text(
            old_preferences
                .acoustid_api_key
                .as_deref()
                .unwrap_or_default(),
        );
        update_acoustid_status_ui(&builder);

        App {
            builder,

            song_history_interface,
            favorites_interface,
            preferences_interface,
            old_preferences,

            #[cfg(target_os = "linux")]
            ctx_systray_handle: Rc::new(RefCell::new(None)),

            ctx_selected_item,
            ctx_buffered_log,
            ctx_logger_source_id,

            gui_tx,
            gui_rx,
            microphone_tx,
            microphone_rx,
            processing_tx,
            processing_rx,
            http_tx,
            http_rx,
        }
    }

    fn load_resources() {
        gio::resources_register_include!("compiled.gresource")
            .expect("Failed to register resources.");
    }

    fn run(self, set_recording: bool, enable_mpris_cli: bool, input_file: Option<String>) {
        let app_id = pulse_app_id();
        let application = adw::Application::new(
            Some(app_id.as_str()),
            gio::ApplicationFlags::HANDLES_OPEN,
        );

        // => https://gtk-rs.org/gtk-rs-core/git/docs/gio/struct.Application.html
        // => https://gtk-rs.org/gtk-rs-core/git/docs/gio/prelude/trait.ApplicationExtManual.html#method.run
        // => https://gtk-rs.org/gtk-rs-core/git/docs/gio/struct.ApplicationFlags.html#associatedconstant.HANDLES_COMMAND_LINE

        // We create a callback for handling files to recognize opened
        // from the command line or through "xdg-open".

        let processing_tx = self.processing_tx.clone();

        application.connect_open(move |_application, files, _hint| {
            if files.len() >= 1 {
                if let Some(file_path) = files[0].path() {
                    let file_path_string = file_path.into_os_string().into_string().unwrap();

                    processing_tx
                        .try_send(ProcessingMessage::ProcessAudioFile(file_path_string))
                        .unwrap();
                }
            }
        });

        application.connect_activate(move |application| {
            let main_window = &application.windows()[0];

            // Raise/highlight the existing window whenever a second
            // GUI instance is attempted to be launched
            main_window.present();
        });

        application.connect_startup(move |application| {
            self.on_startup(application, set_recording, enable_mpris_cli);
        });

        if let Some(input_file_string) = input_file {
            application.run_with_args(&["songrec".to_string(), input_file_string]);
        } else {
            application.run_with_args(&["songrec".to_string()]);
        }
    }

    fn notify_application_error(
        preferences_interface: Arc<Mutex<PreferencesInterface>>,
        label: &str,
        application: &adw::Application,
    ) {
        if preferences_interface
            .lock()
            .unwrap()
            .preferences
            .enable_notifications
            == Some(true)
        {
            let notification = gio::Notification::new(&gettext("Application error"));
            notification.set_body(Some(&label));
            notification.set_category(Some("network.error"));
            application.send_notification(Some("application-error"), &notification);
        }
    }

    fn notify_network_error(
        preferences_interface: Arc<Mutex<PreferencesInterface>>,
        label: &str,
        application: &adw::Application,
        always: bool,
    ) {
        if always
            || preferences_interface
                .lock()
                .unwrap()
                .preferences
                .enable_notifications
                == Some(true)
        {
            let notification = gio::Notification::new(&gettext("Network error"));
            notification.set_body(Some(&label));
            notification.set_category(Some("network.error"));
            application.send_notification(Some("network-error"), &notification);
        }
    }

    fn on_startup(
        &self,
        application: &adw::Application,
        set_recording: bool,
        enable_mpris_cli: bool,
    ) {
        clear_cache();
        self.setup_intercom(application, set_recording, enable_mpris_cli);
        self.setup_actions(application, enable_mpris_cli);
        #[cfg(target_os = "linux")]
        if self.old_preferences.enable_systray == Some(true) {
            let window: adw::ApplicationWindow = self.builder.object("main_window").unwrap();
            Self::setup_systray(self.ctx_systray_handle.clone(), window, self.gui_tx.clone());
        }
        self.setup_context_menus();
        self.show_window(application);
    }

    #[cfg(target_os = "linux")]
    fn setup_systray(
        ctx_systray_handle: Rc<RefCell<Option<ksni::Handle<SystrayInterface>>>>,
        window: adw::ApplicationWindow,
        gui_tx: async_channel::Sender<GUIMessage>,
    ) {
        glib::spawn_future_local(async move {
            if ctx_systray_handle.take().is_none() {
                match SystrayInterface::try_enable(gui_tx).await {
                    Ok(handle) => {
                        *ctx_systray_handle.borrow_mut() = Some(handle);
                        window.set_hide_on_close(true);
                    }
                    Err(err) => {
                        error!(
                            "{}: {:?}",
                            gettext("Unable to enable notification icon"),
                            err
                        );
                    }
                }
            }
        });
    }

    #[cfg(target_os = "linux")]
    fn unsetup_systray(
        ctx_systray_handle: Rc<RefCell<Option<ksni::Handle<SystrayInterface>>>>,
        window: adw::ApplicationWindow,
    ) {
        let window = window.clone();
        glib::spawn_future_local(async move {
            let ctx_systray_handle = ctx_systray_handle.clone();
            if let Some(handle) = ctx_systray_handle.take() {
                window.set_hide_on_close(false);
                *ctx_systray_handle.borrow_mut() = None;
                SystrayInterface::disable(&handle).await;
            }
        });
    }

    fn setup_context_menus(&self) {
        ContextMenuUtil::connect_menu(
            self.builder.clone(),
            self.builder.object("history_view").unwrap(),
            self.builder.object("history_context_menu").unwrap(),
            self.ctx_selected_item.clone(),
            self.favorites_interface.clone(),
        );

        ContextMenuUtil::connect_menu(
            self.builder.clone(),
            self.builder.object("favorites_view").unwrap(),
            self.builder.object("history_context_menu").unwrap(),
            self.ctx_selected_item.clone(),
            self.favorites_interface.clone(),
        );

        ContextMenuUtil::bind_actions(
            self.builder.object("main_window").unwrap(),
            self.ctx_selected_item.clone(),
            self.song_history_interface.clone(),
            self.favorites_interface.clone(),
        );

        // See:
        // https://github.com/shartrec/kelpie-flight-planner/blob/a5575a5/src/window/airport_view.rs#L266 (right click)
        // https://github.com/shartrec/kelpie-flight-planner/blob/a5575a5/src/window/airport_view.rs#L349 (context menu key)
        // https://discourse.gnome.org/t/adding-a-context-menu-to-a-listview-using-gtk4-rs/19995/5
    }

    fn setup_callbacks(
        microphone_tx_shared: async_channel::Sender<MicrophoneMessage>,
        gui_tx_shared: async_channel::Sender<GUIMessage>,
        builder_shared: gtk::Builder,
        builder_scope: gtk::BuilderRustScope,
    ) {
        let recording_target: Rc<RefCell<Option<(String, bool)>>> = Rc::new(RefCell::new(None));
        let microphone_tx = microphone_tx_shared.clone();
        let recording_target_ptr = recording_target.clone();
        let builder = builder_shared.clone();

        builder_scope.add_callback("loopback_options_switched", move |_values| {
            let loopback_switch: adw::SwitchRow = builder.object("loopback_switch").unwrap();
            let microphone_switch: adw::SwitchRow = builder.object("microphone_switch").unwrap();
            let device_section: adw::PreferencesGroup =
                builder.object("input_device_section").unwrap();
            let g_list_store: gio::ListStore = builder.object("audio_inputs_model").unwrap();

            if loopback_switch.is_active() {
                microphone_switch.set_active(false);
                device_section.set_visible(true);

                let adw_combo_row: adw::ComboRow = builder.object("audio_inputs").unwrap();

                if let Some(current_device) = adw_combo_row.selected_item() {
                    let current_device = current_device.downcast::<ListedDevice>().unwrap();

                    if !current_device.is_monitor() {
                        // Choose a monitor mode device instead

                        for position in 0..g_list_store.n_items() {
                            let other_device = g_list_store
                                .item(position)
                                .unwrap()
                                .downcast::<ListedDevice>()
                                .unwrap();

                            if other_device.is_monitor() {
                                adw_combo_row.set_selected(position);
                                break;
                            }
                        }
                    } else {
                        restart_recording_if_needed(
                            &recording_target_ptr,
                            &microphone_tx,
                            &current_device.inner_name(),
                            true,
                        );
                    }
                }
            } else if !microphone_switch.is_active() && !loopback_switch.is_active() {
                device_section.set_visible(false);
                stop_recording_if_needed(&recording_target_ptr, &microphone_tx);
            }

            None
        });

        let microphone_tx = microphone_tx_shared.clone();
        let recording_target_ptr = recording_target.clone();
        let builder = builder_shared.clone();

        builder_scope.add_callback("microphone_option_switched", move |_values| {
            let microphone_switch: adw::SwitchRow = builder.object("microphone_switch").unwrap();
            let loopback_switch: adw::SwitchRow = builder.object("loopback_switch").unwrap();
            let device_section: adw::PreferencesGroup =
                builder.object("input_device_section").unwrap();
            let g_list_store: gio::ListStore = builder.object("audio_inputs_model").unwrap();

            if microphone_switch.is_active() {
                loopback_switch.set_active(false);
                device_section.set_visible(true);

                let adw_combo_row: adw::ComboRow = builder.object("audio_inputs").unwrap();

                if let Some(current_device) = adw_combo_row.selected_item() {
                    let current_device = current_device.downcast::<ListedDevice>().unwrap();

                    if current_device.is_monitor() {
                        // Choose a non-monitor mode device instead

                        for position in 0..g_list_store.n_items() {
                            let other_device = g_list_store
                                .item(position)
                                .unwrap()
                                .downcast::<ListedDevice>()
                                .unwrap();

                            if !other_device.is_monitor() {
                                adw_combo_row.set_selected(position);
                                break;
                            }
                        }
                    } else {
                        restart_recording_if_needed(
                            &recording_target_ptr,
                            &microphone_tx,
                            &current_device.inner_name(),
                            false,
                        );
                    }
                }
            } else if !microphone_switch.is_active() && !loopback_switch.is_active() {
                device_section.set_visible(false);
                stop_recording_if_needed(&recording_target_ptr, &microphone_tx);
            }

            None
        });

        let microphone_tx = microphone_tx_shared.clone();
        let recording_target_ptr = recording_target.clone();
        let gui_tx = gui_tx_shared.clone();
        let builder = builder_shared.clone();

        builder_scope.add_callback("input_device_switched", move |values| {
            let microphone_switch: adw::SwitchRow = builder.object("microphone_switch").unwrap();
            let loopback_switch: adw::SwitchRow = builder.object("loopback_switch").unwrap();

            let combo_row = values[0].get::<adw::ComboRow>().unwrap();

            // Plug the sound

            if let Some(device) = combo_row.selected_item() {
                let device = device.downcast::<ListedDevice>().unwrap();

                let device_name = device.inner_name();
                let is_monitor = device.is_monitor();

                if microphone_switch.is_active() && is_monitor {
                    microphone_switch.set_active(false);
                    loopback_switch.set_active(true);
                } else if loopback_switch.is_active() && !is_monitor {
                    loopback_switch.set_active(false);
                    microphone_switch.set_active(true);
                }

                // Save the selected microphone device name so that it is
                // remembered after relaunching the app

                let mut new_preference = Preferences::new();
                new_preference.current_device_name = Some(device_name.to_string());
                gui_tx
                    .try_send(GUIMessage::UpdatePreference(new_preference))
                    .unwrap();

                // Should we start recording yet? (will depend of the possible
                // command line flags of the application)

                if microphone_switch.is_active() || loopback_switch.is_active() {
                    restart_recording_if_needed(
                        &recording_target_ptr,
                        &microphone_tx,
                        &device_name,
                        is_monitor,
                    );
                }
            }
            None
        });

        let gui_tx = gui_tx_shared.clone();

        builder_scope.add_callback("buffer_size_changed", move |values| {
            let adjustment = values[0].get::<gtk::Adjustment>().unwrap();
            debug!("Buffer size set to: {}", adjustment.value());
            let mut new_preference = Preferences::new();
            new_preference.buffer_size_secs = Some(adjustment.value() as u64);
            gui_tx
                .try_send(GUIMessage::UpdatePreference(new_preference))
                .unwrap();
            None
        });

        let gui_tx = gui_tx_shared.clone();

        builder_scope.add_callback("interval_changed", move |values| {
            let adjustment = values[0].get::<gtk::Adjustment>().unwrap();
            debug!("Request interval set to: {}", adjustment.value());
            let mut new_preference = Preferences::new();
            new_preference.request_interval_secs_v3 = Some(adjustment.value() as u64);
            gui_tx
                .try_send(GUIMessage::UpdatePreference(new_preference))
                .unwrap();
            None
        });

        let gui_tx = gui_tx_shared.clone();
        let builder = builder_shared.clone();
        builder_scope.add_callback("recognition_engine_changed", move |values| {
            let combo_row = values[0].get::<adw::ComboRow>().unwrap();
            let value = match combo_row.selected() {
                1 => RecognitionEngineMode::SongRecOnly.as_preference_value().to_string(),
                2 => RecognitionEngineMode::AcoustIdOnly.as_preference_value().to_string(),
                _ => RecognitionEngineMode::Hybrid.as_preference_value().to_string(),
            };
            let mut new_preference = Preferences::new();
            new_preference.recognition_engine = Some(value);
            gui_tx
                .try_send(GUIMessage::UpdatePreference(new_preference))
                .unwrap();
            update_acoustid_status_ui(&builder);
            None
        });

        let gui_tx = gui_tx_shared.clone();
        let builder = builder_shared.clone();
        builder_scope.add_callback("acoustid_api_key_changed", move |values| {
            let entry_row = values[0].get::<adw::EntryRow>().unwrap();
            let mut new_preference = Preferences::new();
            new_preference.acoustid_api_key = Some(entry_row.text().to_string());
            gui_tx
                .try_send(GUIMessage::UpdatePreference(new_preference))
                .unwrap();
            update_acoustid_status_ui(&builder);
            None
        });

        let builder = builder_shared;

        builder_scope.add_callback("about_dialog_closed", move |_values| {
            let about_dialog: adw::AboutDialog = builder.object("about_dialog").unwrap();
            about_dialog.set_visible(false);
            None
        });
    }

    fn setup_intercom(
        &self,
        application: &adw::Application,
        set_recording: bool,
        enable_mpris_cli: bool,
    ) {
        // Setup communication using threads + smol-rs/async-channel::unbounded listener

        // NOTE: Dropping the removed glib::MainContext from legacy code:
        // https://discourse.gnome.org/t/help-required-to-migrate-from-dropped-maincontext-channel-api/20922
        // + https://gtk-rs.org/gtk4-rs/stable/latest/book/main_event_loop.html#how-to-avoid-blocking-the-main-loop

        let microphone_rx = self.microphone_rx.clone();
        let processing_tx = self.processing_tx.clone();
        let gui_tx = self.gui_tx.clone();
        let preferences_interface = self.preferences_interface.clone();
        spawn_big_thread(move || {
            microphone_thread(microphone_rx, processing_tx, gui_tx, preferences_interface);
        });

        launch_recognition_pipeline(
            self.processing_rx.clone(),
            self.http_tx.clone(),
            self.gui_tx.clone(),
            self.http_rx.clone(),
            self.gui_tx.clone(),
            self.microphone_tx.clone(),
        );

        let gui_rx = self.gui_rx.clone();
        let preferences_interface_ptr = self.preferences_interface.clone();

        let window: adw::ApplicationWindow = self.builder.object("main_window").unwrap();
        let systray_setting: adw::SwitchRow = self.builder.object("systray_setting").unwrap();
        let adw_combo_row: adw::ComboRow = self.builder.object("audio_inputs").unwrap();
        let g_list_store: gio::ListStore = self.builder.object("audio_inputs_model").unwrap();
        let microphone_switch: adw::SwitchRow = self.builder.object("microphone_switch").unwrap();
        let recognize_file_row: adw::PreferencesRow =
            self.builder.object("recognize_file_row").unwrap();
        let spinner_row: adw::PreferencesRow = self.builder.object("spinner_row").unwrap();
        let volume_row: adw::PreferencesRow = self.builder.object("volume_row").unwrap();
        let volume_gauge: gtk::ProgressBar = self.builder.object("volume_gauge").unwrap();
        let search_youtube_row: adw::ActionRow =
            self.builder.object("search_youtube_row").unwrap();
        let benchmark_summary_row: adw::ActionRow =
            self.builder.object("benchmark_summary_row").unwrap();
        let benchmark_engine_row: adw::ActionRow =
            self.builder.object("benchmark_engine_row").unwrap();
        let benchmark_latency_row: adw::ActionRow =
            self.builder.object("benchmark_latency_row").unwrap();
        let benchmark_last_row: adw::ActionRow =
            self.builder.object("benchmark_last_row").unwrap();
        let results_section: adw::PreferencesGroup =
            self.builder.object("results_section").unwrap();
        let no_network_message: gtk::Label = self.builder.object("no_network_message").unwrap();
        let rate_limited_message: gtk::Label = self.builder.object("rate_limited_message").unwrap();
        let results_image: gtk::Image = self.builder.object("results_image").unwrap();
        let results_label: gtk::Label = self.builder.object("results_label").unwrap();
        let loopback_switch: adw::SwitchRow = self.builder.object("loopback_switch").unwrap();
        let quick_device_section: adw::PreferencesGroup =
            self.builder.object("quick_device_section").unwrap();
        let quick_device_buttons_box: gtk::Box =
            self.builder.object("quick_device_buttons_box").unwrap();
        volume_gauge.add_css_class("aura-meter");

        #[cfg(target_os = "linux")]
        systray_setting.set_visible(true);

        microphone_switch.set_active(set_recording);

        let song_history_interface = self.song_history_interface.clone();
        let old_preferences = self.old_preferences.clone();
        let ctx_buffered_log = self.ctx_buffered_log.clone();
        let application = application.clone();
        let microphone_tx_refresh = self.microphone_tx.clone();
        let gui_tx_ui = self.gui_tx.clone();
        let last_devices_signature: Rc<RefCell<String>> = Rc::new(RefCell::new(String::new()));
        let last_devices_signature_ptr = last_devices_signature.clone();

        glib::timeout_add_seconds_local(2, move || {
            let _ = microphone_tx_refresh.try_send(MicrophoneMessage::RefreshDevices);
            glib::ControlFlow::Continue
        });

        glib::spawn_future_local(async move {
            #[cfg(feature = "mpris")]
            let mut mpris_obj = {
                let player = if enable_mpris_cli && old_preferences.enable_mpris == Some(true) {
                    get_player()
                } else {
                    None
                };
                if enable_mpris_cli
                    && old_preferences.enable_mpris == Some(true)
                    && player.is_none()
                {
                    println!("{}", gettext("Unable to enable MPRIS support"))
                }
                player
            };
            #[cfg(feature = "mpris")]
            let mut last_cover_path = None;

            while let Ok(gui_message) = gui_rx.recv().await {
                if let AppendToLog(log_string) = gui_message {
                    const MAX_LOG_SIZE: usize = 2 * 1024 * 1024; // 2 MB

                    {
                        let buffer_ptr: &mut String = &mut *ctx_buffered_log.borrow_mut();
                        buffer_ptr.push_str(&log_string);
                        if buffer_ptr.len() > MAX_LOG_SIZE {
                            let to_cut: String = buffer_ptr
                                .chars()
                                .take(buffer_ptr.len() - MAX_LOG_SIZE)
                                .collect();
                            buffer_ptr.drain(..to_cut.len());
                        }
                    }
                } else {
                    if let MicrophoneVolumePercent(_) = gui_message {
                        trace!("Received GUI message: {:?}", gui_message);
                    } else if let SongRecognized(ref msg) = gui_message {
                        debug!("Received GUI message: SongRecognized({})", json!({
                            "artist_name": msg.artist_name.clone(),
                            "album_name": msg.album_name.clone(),
                            "song_name": msg.song_name.clone(),
                            "cover_image": match &msg.cover_image {
                                Some(data) => Some::<String>(format!("{:02x?}...", &data[..16]).into()),
                                None => None
                            },
                            "track_key": msg.track_key.clone(),
                            "release_year": msg.release_year.clone(),
                            "genre": msg.genre.clone(),
                            "shazam_json": msg.shazam_json.clone()
                        }).to_string());
                    } else {
                        debug!("Received GUI message: {:?}", gui_message);
                    }

                    match gui_message {
                        ErrorMessage(_) | NetworkStatus(_) | SongRecognized(_) => {
                            recognize_file_row.set_sensitive(true);
                            spinner_row.set_visible(false);
                        }
                        _ => {}
                    }

                    match gui_message {
                        UpdatePreference(new_preference) => {
                            preferences_interface_ptr
                                .lock()
                                .unwrap()
                                .update(new_preference);
                            #[cfg(feature = "mpris")]
                            if mpris_obj.is_none() {
                                let mpris_enabled = preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .enable_mpris
                                    == Some(true);

                                mpris_obj = {
                                    let player = if enable_mpris_cli && mpris_enabled {
                                        get_player()
                                    } else {
                                        None
                                    };
                                    if enable_mpris_cli && mpris_enabled && player.is_none() {
                                        println!("{}", gettext("Unable to enable MPRIS support"))
                                    }
                                    player
                                };
                            }
                        }
                        ErrorMessage(string) => {
                            if !(string == gettext("No match for this song")
                                && (microphone_switch.is_active() || loopback_switch.is_active()))
                            {
                                error!("Displaying error: {}", string);
                                let dialog = adw::AlertDialog::builder()
                                    .body(&string)
                                    .close_response("ok")
                                    .default_response("ok")
                                    .build();
                                dialog.add_responses(&[("ok", &gettext("_Ok"))]);
                                glib::spawn_future_local(dialog.choose_future(Some(&window)));

                                if string != gettext("No match for this song") {
                                    Self::notify_application_error(
                                        preferences_interface_ptr.clone(),
                                        &string,
                                        &application.clone(),
                                    );
                                }
                            }
                        }
                        RecognitionBenchmarkUpdate(snapshot) => {
                            update_benchmark_rows(
                                &benchmark_summary_row,
                                &benchmark_engine_row,
                                &benchmark_latency_row,
                                &benchmark_last_row,
                                &snapshot,
                            );
                        }
                        RateLimitState(is_rate_limited) => {
                            if is_rate_limited && !rate_limited_message.is_visible() {
                                Self::notify_network_error(
                                    preferences_interface_ptr.clone(),
                                    &rate_limited_message.label(),
                                    &application.clone(),
                                    true,
                                );
                            }
                            rate_limited_message.set_visible(is_rate_limited);
                        }
                        NetworkStatus(network_is_reachable) => {
                            if !network_is_reachable && !no_network_message.is_visible() {
                                Self::notify_network_error(
                                    preferences_interface_ptr.clone(),
                                    &no_network_message.label(),
                                    &application.clone(),
                                    false,
                                );
                            }
                            no_network_message.set_visible(!network_is_reachable);

                            #[cfg(feature = "mpris")]
                            {
                                let mpris_enabled = preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .enable_mpris
                                    == Some(true);

                                if mpris_enabled {
                                    let mpris_status = if network_is_reachable {
                                        PlaybackStatus::Playing
                                    } else {
                                        PlaybackStatus::Paused
                                    };

                                    mpris_obj
                                        .as_ref()
                                        .map(|p| p.set_playback_status(mpris_status));
                                }
                            }
                        }
                        SongRecognized(message) => {
                            apply_adaptive_window_layout(
                                &window,
                                &results_section,
                                true,
                            );

                            let song_name =
                                format!("{} - {}", message.artist_name, message.song_name);
                            let engine_label = match message.recognition_engine.as_deref() {
                                Some("acoustid") => "AcoustID",
                                Some("songrec") => "SongRec",
                                _ => "Hybrid",
                            };
                            let secondary_candidate = extract_secondary_candidate_from_shazam(
                                &message.shazam_json,
                                &message.track_key,
                            );
                            let subtitle = match secondary_candidate {
                                Some(candidate) => {
                                    format!("Tanıma motoru: {} | Alternatif: {}", engine_label, candidate)
                                }
                                None => format!("Tanıma motoru: {}", engine_label),
                            };
                            search_youtube_row.set_subtitle(&subtitle);
                            info!("Recognized via {}", engine_label);
                            let song_changed = results_label.text().as_str() != &song_name;

                            results_label.set_label(&song_name);

                            if let Some(ref cover_image) = message.cover_image {
                                if let Some(texture) = decode_cover_texture(cover_image) {
                                    results_image.set_visible(true);
                                    results_image.set_paintable(Some(&texture));
                                    match message.album_name {
                                        Some(ref value) => {
                                            results_image.set_tooltip_text(Some(&value))
                                        }
                                        None => results_image.set_tooltip_text(None),
                                    };
                                } else {
                                    results_image.set_visible(false);
                                    results_image.set_paintable(Option::<&gdk::Paintable>::None);
                                    results_image.set_tooltip_text(None);
                                }
                            } else {
                                results_image.set_visible(false);
                                results_image.set_paintable(Option::<&gdk::Paintable>::None);
                                results_image.set_tooltip_text(None);
                            }

                            if song_changed {
                                let notification =
                                    gio::Notification::new(&gettext("Song recognized"));
                                notification.set_body(Some(&song_name));

                                if let Some(ref cover_image) = message.cover_image {
                                    if let Some(texture) = decode_cover_texture(cover_image) {
                                        notification.set_icon(&texture);
                                    }
                                }

                                #[cfg(feature = "mpris")]
                                if preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .enable_mpris
                                    == Some(true)
                                {
                                    mpris_obj
                                        .as_ref()
                                        .map(|p| update_song(p, &message, &mut last_cover_path));
                                }

                                if preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .enable_notifications
                                    == Some(true)
                                {
                                    application
                                        .send_notification(Some("recognized-song"), &notification);
                                }

                                let new_entry = SongHistoryRecord {
                                    song_name: song_name,
                                    album: Some(
                                        message
                                            .album_name
                                            .as_ref()
                                            .unwrap_or(&"".to_string())
                                            .to_string(),
                                    ),
                                    track_key: Some(message.track_key),
                                    release_year: Some(
                                        message
                                            .release_year
                                            .as_ref()
                                            .unwrap_or(&"".to_string())
                                            .to_string(),
                                    ),
                                    genre: Some(
                                        message
                                            .genre
                                            .as_ref()
                                            .unwrap_or(&"".to_string())
                                            .to_string(),
                                    ),
                                    recognition_date: Local::now().format("%c").to_string(),
                                };

                                if preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .no_duplicates
                                    == Some(true)
                                {
                                    song_history_interface
                                        .borrow_mut()
                                        .remove(new_entry.clone());
                                }
                                song_history_interface
                                    .borrow_mut()
                                    .add_row_and_save(new_entry);
                            }
                        }
                        // This message is sent once in the program execution for
                        // the moment (maybe it should be updated automatically
                        // later?):
                        DevicesList(devices) => {
                            let devices_signature = devices
                                .iter()
                                .map(|device| {
                                    format!(
                                        "{}|{}|{}",
                                        device.inner_name, device.display_name, device.is_monitor
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join("||");
                            if *last_devices_signature_ptr.borrow() == devices_signature {
                                continue;
                            }
                            *last_devices_signature_ptr.borrow_mut() = devices_signature;

                            let current_device_name = preferences_interface_ptr
                                .lock()
                                .unwrap()
                                .preferences
                                .current_device_name
                                .clone();
                            let selected_device_name = adw_combo_row
                                .selected_item()
                                .and_then(|item| item.downcast::<ListedDevice>().ok())
                                .map(|item| item.inner_name().to_string());
                            let preferred_loopback_device_name = devices
                                .iter()
                                .find(|device| is_headphone_output_candidate(device))
                                .map(|device| device.inner_name.clone());
                            let mut auto_switched_device_label: Option<String> = None;
                            let mut auto_switched_device_name: Option<String> = None;
                            let mut initial_device_index: u32 = 0;
                            let mut initial_device: Option<ListedDevice> = None;
                            let mut found_monitor_device = false;
                            let mut current_index: u32 = 0;
                            let mut preferred_device_locked = false;
                            let quick_devices: Vec<DeviceListItem> = devices
                                .iter()
                                .filter(|device| is_quick_device_candidate(device))
                                .map(|device| DeviceListItem {
                                    inner_name: device.inner_name.clone(),
                                    display_name: device.display_name.clone(),
                                    is_monitor: device.is_monitor,
                                })
                                .collect();

                            for device in devices.iter() {
                                if preferred_loopback_device_name.as_ref()
                                    == Some(&device.inner_name)
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                    preferred_device_locked = true;
                                } else if !preferred_device_locked
                                    && loopback_switch.is_active()
                                    && device.is_monitor
                                    && initial_device.is_none()
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                } else if !preferred_device_locked
                                    && selected_device_name == Some(device.inner_name.to_string())
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                } else if !preferred_device_locked
                                    && current_device_name == Some(device.inner_name.to_string())
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                } else if !preferred_device_locked
                                    && current_device_name == None
                                    && device.is_monitor
                                    && !found_monitor_device
                                    && loopback_switch.is_active()
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                } else if !preferred_device_locked
                                    && current_device_name == None
                                    && device.is_monitor
                                    && !found_monitor_device
                                {
                                    initial_device_index = current_index;
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                } else if current_index == 0 {
                                    initial_device = Some(ListedDevice::new(
                                        device.display_name.clone(),
                                        device_indicator_markup(false),
                                        device.inner_name.clone(),
                                        device.is_monitor,
                                    ));
                                }
                                current_index += 1;

                                if device.is_monitor {
                                    found_monitor_device = true;
                                }
                            }

                            if let Some(ref device) = initial_device {
                                // device: ListedDevice
                                let next_device_name = device.inner_name().to_string();
                                let next_device_label = device.display_name().to_string();
                                let previous_device_name =
                                    selected_device_name.clone().or(current_device_name.clone());
                                if previous_device_name
                                        .as_ref()
                                        .map(|name| name != &next_device_name)
                                        .unwrap_or(false)
                                    && device.is_monitor()
                                {
                                    auto_switched_device_label = Some(next_device_label);
                                    auto_switched_device_name = Some(next_device_name.clone());
                                }
                                loopback_switch.set_visible(found_monitor_device);

                                debug!(
                                    "Initally selected audio input device: {:?} / {:?}",
                                    device.inner_name(),
                                    device.display_name()
                                );

                                microphone_switch.set_visible(true);
                                volume_row.set_visible(true);

                                // Will trigger the "input_device_switched" callback
                            }

                            if let Some(device_label) = auto_switched_device_label {
                                if preferences_interface_ptr
                                    .lock()
                                    .unwrap()
                                    .preferences
                                    .enable_notifications
                                    == Some(true)
                                {
                                    let notification =
                                        gio::Notification::new(&gettext("Audio device switched"));
                                    notification.set_body(Some(&format!(
                                        "{}: {}",
                                        gettext("Automatically switched to"),
                                        device_label
                                    )));
                                    application.send_notification(
                                        Some("audio-device-auto-switched"),
                                        &notification,
                                    );
                                }
                            }

                            let active_quick_device_name = auto_switched_device_name
                                .clone()
                                .or_else(|| {
                                    initial_device
                                        .as_ref()
                                        .map(|device| device.inner_name().to_string())
                                })
                                .or_else(|| selected_device_name.clone())
                                .or_else(|| current_device_name.clone());
                            let active_device_name = initial_device
                                .as_ref()
                                .map(|device| device.inner_name().to_string())
                                .or_else(|| selected_device_name.clone())
                                .or_else(|| current_device_name.clone());

                            g_list_store.remove_all();
                            while let Some(child) = quick_device_buttons_box.first_child() {
                                quick_device_buttons_box.remove(&child);
                            }

                            for device in devices.iter() {
                                let listed_device = ListedDevice::new(
                                    device.display_name.clone(),
                                    device_indicator_markup(
                                        active_device_name
                                            .as_ref()
                                            .map(|name| name == &device.inner_name)
                                            .unwrap_or(false),
                                    ),
                                    device.inner_name.clone(),
                                    device.is_monitor,
                                );
                                g_list_store.append(&listed_device);
                            }

                            if initial_device.is_some() {
                                adw_combo_row.set_selected(initial_device_index);
                            }

                            quick_device_section.set_visible(!quick_devices.is_empty());
                            for quick_device in quick_devices {
                                let is_active = active_quick_device_name
                                    .as_ref()
                                    .map(|name| name == &quick_device.inner_name)
                                    .unwrap_or(false);
                                let button = gtk::Button::builder()
                                    .label(quick_device_label(&quick_device, is_active))
                                    .halign(gtk::Align::Fill)
                                    .hexpand(true)
                                    .tooltip_text(&quick_device.display_name)
                                    .build();
                                button.add_css_class("quick-device-chip");
                                if quick_device.is_monitor {
                                    button.add_css_class("quick-device-monitor");
                                } else {
                                    button.add_css_class("quick-device-mic");
                                }
                                if is_active {
                                    button.add_css_class("quick-device-chip-active");
                                } else {
                                    button.add_css_class("quick-device-chip-idle");
                                }

                                let adw_combo_row = adw_combo_row.clone();
                                let g_list_store = g_list_store.clone();
                                let microphone_switch = microphone_switch.clone();
                                let loopback_switch = loopback_switch.clone();
                                let gui_tx_ui = gui_tx_ui.clone();
                                let inner_name = quick_device.inner_name.clone();
                                let is_monitor = quick_device.is_monitor;

                                button.connect_clicked(move |_| {
                                    for position in 0..g_list_store.n_items() {
                                        let maybe_item = g_list_store.item(position);
                                        if let Some(item) = maybe_item {
                                            if let Ok(device) = item.downcast::<ListedDevice>() {
                                                if device.inner_name() == inner_name {
                                                    adw_combo_row.set_selected(position);
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    let mut new_preference = Preferences::new();
                                    new_preference.current_device_name = Some(inner_name.clone());
                                    let _ = gui_tx_ui.try_send(GUIMessage::UpdatePreference(new_preference));

                                    if is_monitor {
                                        microphone_switch.set_active(false);
                                        loopback_switch.set_active(true);
                                    } else {
                                        loopback_switch.set_active(false);
                                        microphone_switch.set_active(true);
                                    }
                                });

                                quick_device_buttons_box.append(&button);
                            }
                        }
                        MicrophoneRecording => {
                            apply_adaptive_window_layout(
                                &window,
                                &results_section,
                                false,
                            );
                        }

                        MicrophoneVolumePercent(percent) => {
                            volume_gauge.set_fraction((percent / 100.0) as f64);
                        }

                        WipeSongHistory => {
                            let dialog = adw::AlertDialog::builder()
                                .body(&gettext("Are you sure you want to wipe history?"))
                                .default_response("yes")
                                .close_response("no")
                                .build();

                            dialog.add_responses(&[
                                ("yes", &gettext("_Yes")),
                                ("no", &gettext("_No")),
                            ]);

                            let song_history_interface = song_history_interface.clone();
                            dialog.choose(
                                Some(&window),
                                None::<&gio::Cancellable>,
                                move |result| {
                                    if result == "yes" {
                                        song_history_interface.borrow_mut().wipe_and_save();
                                    }
                                },
                            );
                        }

                        ShowWindow => {
                            window.present();
                        }

                        QuitApplication => {
                            application.quit();
                        }

                        _ => {
                            debug!("(parsing unimplemented yet): {:?}", gui_message);
                        }
                    }

                    // Possibly handle missing messages here
                }
            }
        });
    }

    fn setup_actions(&self, application: &adw::Application, enable_mpris_cli: bool) {
        let window: adw::ApplicationWindow = self.builder.object("main_window").unwrap();
        let file_picker: gtk::FileDialog = self.builder.object("file_picker").unwrap();
        let shortcuts_dialog: gtk::ShortcutsWindow =
            self.builder.object("shortcuts_window").unwrap();
        let about_dialog: adw::AboutDialog = self.builder.object("about_dialog").unwrap();
        let results_label: gtk::Label = self.builder.object("results_label").unwrap();
        let results_section: adw::PreferencesGroup =
            self.builder.object("results_section").unwrap();
        let menu_button: gtk::MenuButton = self.builder.object("menu_button").unwrap();
        let recognize_file_row: adw::PreferencesRow =
            self.builder.object("recognize_file_row").unwrap();
        let spinner_row: adw::PreferencesRow = self.builder.object("spinner_row").unwrap();

        let ctx_buffered_log = self.ctx_buffered_log.clone();
        let ctx_logger_source_id = self.ctx_logger_source_id.clone();

        let action_show_about = gio::ActionEntry::builder("show-about")
            .activate(move |window, _, _| {
                about_dialog.set_visible(true);
                about_dialog.present(Some(window));

                about_dialog.set_debug_info(&*ctx_buffered_log.borrow());

                // Sync the debug info with the About modal at most every
                // 1 sec as it may require a lot of text rendering power
                // each time

                let ctx_buffered_log = ctx_buffered_log.clone();
                let ctx_logger_source_id_2 = ctx_logger_source_id.clone();
                let about_dialog = about_dialog.clone();

                if *ctx_logger_source_id.borrow() == None {
                    *ctx_logger_source_id.borrow_mut() =
                        Some(glib::source::timeout_add_seconds_local(1, move || {
                            if about_dialog.is_visible() {
                                about_dialog.set_debug_info(&*ctx_buffered_log.borrow());
                                glib::ControlFlow::Continue
                            } else {
                                *ctx_logger_source_id_2.borrow_mut() = None;
                                glib::ControlFlow::Break
                            }
                        }));
                }
            })
            .build();

        let processing_tx = self.processing_tx.clone();

        let action_recognize_file = gio::ActionEntry::builder("recognize-file")
            .activate(move |window: &adw::ApplicationWindow, _action, _obj| {
                // Call a XDG file picker here

                let processing_tx = processing_tx.clone();

                let window = window.clone();
                let window_for_result = window.clone();
                let recognize_file_row = recognize_file_row.clone();
                let spinner_row = spinner_row.clone();
                let results_section = results_section.clone();

                file_picker.open(
                    Some(&window),
                    None::<&gio::Cancellable>,
                    move |file| match file {
                        Ok(gio_file) => {
                            info!("Picked file: {:?}", gio_file.path());
                            let path_str = gio_file.path().unwrap().to_string_lossy().into_owned();

                            recognize_file_row.set_sensitive(false);
                            spinner_row.set_visible(true);
                            apply_adaptive_window_layout(
                                &window_for_result,
                                &results_section,
                                false,
                            );

                            processing_tx
                                .try_send(ProcessingMessage::ProcessAudioFile(path_str))
                                .unwrap();
                        }
                        Err(error) => {
                            error!("Error picking file: {:?}", error);
                        }
                    },
                );
            })
            .build();

        let action_search_youtube = gio::ActionEntry::builder("search-youtube")
            .activate(move |window: &adw::ApplicationWindow, _, _| {
                let window = window.clone();

                let results_label = results_label.text();
                let query = results_label.as_str().to_string();

                if Self::try_open_search_inside_aurivo(&query, "youtube") {
                    info!("Forwarded search query to Aurivo app: {}", query);
                    return;
                }

                let mut encoded_search_term =
                    utf8_percent_encode(results_label.as_str(), NON_ALPHANUMERIC).to_string();
                encoded_search_term = encoded_search_term.replace("%20", "+");

                let search_url = format!(
                    "https://www.youtube.com/results?search_query={}",
                    encoded_search_term
                );

                glib::spawn_future_local(async move {
                    info!("Launching URL: {}", search_url);
                    if let Err(err) = gtk::UriLauncher::new(&search_url)
                        .launch_future(Some(&window))
                        .await
                    {
                        error!("Could not launch URL {}: {:?}", search_url, err);
                    }
                });
            })
            .build();

        let action_export_to_csv = gio::ActionEntry::builder("export-to-csv")
            .activate(move |window: &adw::ApplicationWindow, _action, _obj| {
                #[cfg(not(windows))]
                {
                    let window = window.clone();

                    glib::spawn_future_local(async move {
                        let launch_path = obtain_recognition_history_csv_path().unwrap();
                        info!("Launching file: {}", launch_path);
                        let launch_file = gio::File::for_path(launch_path.clone());
                        if let Err(err) = gtk::FileLauncher::new(Some(&launch_file))
                            .launch_future(Some(&window))
                            .await
                        {
                            error!("Could not launch file {}: {:?}", launch_path, err);
                        }
                    });
                }

                #[cfg(windows)]
                std::process::Command::new("cmd")
                    .args(&[
                        "/c",
                        &format!("start {}", obtain_recognition_history_csv_path().unwrap()),
                    ])
                    .creation_flags(0x00000008) // Set "CREATE_NO_WINDOW" on Windows
                    .output()
                    .ok();
            })
            .build();

        let action_export_favorites_to_csv = gio::ActionEntry::builder("export-favorites-to-csv")
            .activate(move |window: &adw::ApplicationWindow, _action, _obj| {
                #[cfg(not(windows))]
                {
                    let window = window.clone();

                    glib::spawn_future_local(async move {
                        let launch_path = obtain_favorites_csv_path().unwrap();
                        info!("Launching file: {}", launch_path);
                        let launch_file = gio::File::for_path(launch_path.clone());
                        if let Err(err) = gtk::FileLauncher::new(Some(&launch_file))
                            .launch_future(Some(&window))
                            .await
                        {
                            error!("Could not launch file {}: {:?}", launch_path, err);
                        }
                    });
                }

                #[cfg(windows)]
                std::process::Command::new("cmd")
                    .args(&[
                        "/c",
                        &format!("start {}", obtain_favorites_csv_path().unwrap()),
                    ])
                    .creation_flags(0x00000008) // Set "CREATE_NO_WINDOW" on Windows
                    .output()
                    .ok();
            })
            .build();

        let gui_tx = self.gui_tx.clone();

        let action_wipe_history = gio::ActionEntry::builder("wipe-history")
            .activate(move |_window, _action, _obj| {
                gui_tx.try_send(GUIMessage::WipeSongHistory).unwrap();
            })
            .build();

        let http_tx = self.http_tx.clone();
        let action_reset_benchmark = gio::ActionEntry::builder("reset-benchmark")
            .activate(move |_window, _action, _obj| {
                let _ = http_tx.try_send(HTTPMessage::ResetBenchmark);
            })
            .build();

        let gui_tx = self.gui_tx.clone();

        #[cfg(feature = "mpris")]
        let action_mpris_setting = gio::ActionEntry::builder("mpris-setting")
            .state(self.old_preferences.enable_mpris.unwrap().to_variant())
            .activate(move |_, action, _| {
                let state = action.state().unwrap();
                let action_state: bool = state.get().unwrap();
                let new_state = !action_state; // toggle
                action.set_state(&new_state.to_variant());

                let mut new_preference: Preferences = Preferences::new();
                new_preference.enable_mpris = Some(new_state);
                gui_tx
                    .try_send(GUIMessage::UpdatePreference(new_preference))
                    .unwrap();
            })
            .build();

        let gui_tx = self.gui_tx.clone();

        let action_notification_setting = gio::ActionEntry::builder("notification-setting")
            .state(
                self.old_preferences
                    .enable_notifications
                    .unwrap()
                    .to_variant(),
            )
            .activate(move |_, action, _| {
                let state = action.state().unwrap();
                let action_state: bool = state.get().unwrap();
                let new_state = !action_state; // toggle
                action.set_state(&new_state.to_variant());

                let mut new_preference: Preferences = Preferences::new();
                new_preference.enable_notifications = Some(new_state);
                gui_tx
                    .try_send(GUIMessage::UpdatePreference(new_preference))
                    .unwrap();
            })
            .build();

        let gui_tx = self.gui_tx.clone();
        #[cfg(target_os = "linux")]
        let ctx_systray_handle = self.ctx_systray_handle.clone();

        #[cfg(target_os = "linux")]
        let action_systray_setting = gio::ActionEntry::builder("systray-setting")
            .state(self.old_preferences.enable_systray.unwrap().to_variant())
            .activate(
                move |window: &adw::ApplicationWindow, action: &gio::SimpleAction, _| {
                    let state = action.state().unwrap();
                    let action_state: bool = state.get().unwrap();
                    let new_state = !action_state; // toggle
                    action.set_state(&new_state.to_variant());

                    let ctx_systray_handle = ctx_systray_handle.clone();

                    if new_state {
                        Self::setup_systray(ctx_systray_handle, window.clone(), gui_tx.clone());
                    } else {
                        Self::unsetup_systray(ctx_systray_handle, window.clone());
                    }

                    let mut new_preference: Preferences = Preferences::new();
                    new_preference.enable_systray = Some(new_state);
                    gui_tx
                        .try_send(GUIMessage::UpdatePreference(new_preference))
                        .unwrap();
                },
            )
            .build();

        let gui_tx = self.gui_tx.clone();

        let action_no_dupes_setting = gio::ActionEntry::builder("no-dupes-setting")
            .state(self.old_preferences.no_duplicates.unwrap().to_variant())
            .activate(move |_, action, _| {
                let state = action.state().unwrap();
                let action_state: bool = state.get().unwrap();
                let new_state = !action_state; // toggle
                action.set_state(&new_state.to_variant());

                let mut new_preference: Preferences = Preferences::new();
                new_preference.no_duplicates = Some(new_state);
                gui_tx
                    .try_send(GUIMessage::UpdatePreference(new_preference))
                    .unwrap();
            })
            .build();

        let action_close = gio::ActionEntry::builder("close")
            .activate(move |window: &adw::ApplicationWindow, _, _| {
                window.close();
            })
            .build();

        let action_display_shortcuts = gio::ActionEntry::builder("display-shortcuts")
            .activate(move |_, _, _| {
                shortcuts_dialog.present();
            })
            .build();

        let microphone_tx = self.microphone_tx.clone();

        let action_refresh_devices = gio::ActionEntry::builder("refresh-devices")
            .activate(move |_, _, _| {
                microphone_tx
                    .try_send(MicrophoneMessage::RefreshDevices)
                    .unwrap();
            })
            .build();

        let action_show_menu = gio::ActionEntry::builder("show-menu")
            .activate(move |_, _, _| {
                menu_button.activate();
            })
            .build();

        window.add_action_entries([
            action_show_about,
            action_recognize_file,
            action_search_youtube,
            action_export_to_csv,
            action_export_favorites_to_csv,
            action_wipe_history,
            action_reset_benchmark,
            action_display_shortcuts,
            action_notification_setting,
            #[cfg(target_os = "linux")]
            action_systray_setting,
            action_no_dupes_setting,
            action_refresh_devices,
            action_close,
            action_show_menu,
        ]);

        #[cfg(feature = "mpris")]
        if enable_mpris_cli {
            window.add_action_entries([action_mpris_setting]);
        }

        // GDK key names are available here:
        // https://gitlab.gnome.org/GNOME/gtk/-/blob/main/gdk/gdkkeysyms.h

        application.set_accels_for_action("win.close", &["<Ctrl>Q", "<Primary>W"]);
        application.set_accels_for_action("win.recognize-file", &["<Ctrl>O"]);
        application.set_accels_for_action("win.display-shortcuts", &["<Primary>question"]);
        application.set_accels_for_action("win.show-menu", &["F10"]);
    }

    fn show_window(&self, application: &adw::Application) {
        let window: adw::ApplicationWindow = self.builder.object("main_window").unwrap();
        window.set_application(Some(application));
        window.set_default_size(1080, 760);
        window.set_size_request(980, 680);

        window.present();
    }
}
