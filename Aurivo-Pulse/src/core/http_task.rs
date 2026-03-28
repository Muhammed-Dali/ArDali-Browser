use gettextrs::gettext;
use regex::Regex;
use serde_json::{to_string_pretty, Value};
use soup::prelude::SessionExt;
use std::error::Error;
use std::time::{Duration, Instant};

use crate::core::recognition;
use crate::core::recognition::RecognitionEngineMode;
use crate::core::thread_messages::*;
#[cfg(feature = "gui")]
use crate::gui::preferences::PreferencesInterface;

use crate::fingerprinting::communication::{obtain_raw_cover_image, recognize_song_from_signature};
use crate::fingerprinting::signature_format::DecodedSignature;

fn pick_cover_url(json_object: &Value) -> Option<String> {
    for key in ["coverarthq", "coverart", "background"] {
        if let Value::String(url) = &json_object["track"]["images"][key] {
            if !url.trim().is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

fn load_runtime_recognition_settings() -> (RecognitionEngineMode, Option<String>) {
    #[cfg(feature = "gui")]
    {
        let pref = PreferencesInterface::new().preferences;
        let mode = RecognitionEngineMode::from_preference_value(pref.recognition_engine.as_deref());
        let api_key = recognition::resolve_acoustid_client_key(pref.acoustid_api_key.as_deref());
        return (mode, api_key);
    }

    #[cfg(not(feature = "gui"))]
    {
        (
            RecognitionEngineMode::Hybrid,
            recognition::resolve_acoustid_client_key(None),
        )
    }
}

fn update_benchmark_success(
    benchmark: &mut RecognitionBenchmarkSnapshot,
    engine: &str,
    latency_ms: u64,
) {
    benchmark.attempts_total = benchmark.attempts_total.saturating_add(1);
    benchmark.success_total = benchmark.success_total.saturating_add(1);
    benchmark.last_latency_ms = latency_ms;
    benchmark.last_engine = engine.to_string();
    benchmark.last_outcome = "success".to_string();
    let prev_total = benchmark.avg_latency_ms.saturating_mul(benchmark.success_total.saturating_sub(1));
    benchmark.avg_latency_ms = prev_total
        .saturating_add(latency_ms)
        .saturating_div(benchmark.success_total.max(1));
    match engine {
        "SongRec" => benchmark.songrec_success = benchmark.songrec_success.saturating_add(1),
        "AcoustID" => benchmark.acoustid_success = benchmark.acoustid_success.saturating_add(1),
        _ => {}
    }
}

fn update_benchmark_failure(
    benchmark: &mut RecognitionBenchmarkSnapshot,
    outcome: &str,
    latency_ms: u64,
) {
    benchmark.attempts_total = benchmark.attempts_total.saturating_add(1);
    benchmark.last_latency_ms = latency_ms;
    benchmark.last_engine = "-".to_string();
    benchmark.last_outcome = outcome.to_string();
}

fn send_benchmark_update(
    gui_tx: &async_channel::Sender<GUIMessage>,
    benchmark: &RecognitionBenchmarkSnapshot,
) {
    let _ = gui_tx.try_send(GUIMessage::RecognitionBenchmarkUpdate(benchmark.clone()));
}

async fn try_recognize_song(
    session: &soup::Session,
    signature: DecodedSignature,
) -> Result<SongRecognizedMessage, Box<dyn Error>> {
    let json_object = recognize_song_from_signature(session, &signature).await?;

    let mut album_name: Option<String> = None;
    let mut release_year: Option<String> = None;

    // Sometimes the idea of trying to write functional poetry hurts

    if let Value::Array(sections) = &json_object["track"]["sections"] {
        for section in sections {
            if let Value::String(string) = &section["type"] {
                if string == "SONG" {
                    if let Value::Array(metadata) = &section["metadata"] {
                        for metadatum in metadata {
                            if let Value::String(title) = &metadatum["title"] {
                                if title == "Album" {
                                    if let Value::String(text) = &metadatum["text"] {
                                        album_name = Some(text.to_string());
                                    }
                                } else if title == "Released" {
                                    if let Value::String(text) = &metadatum["text"] {
                                        release_year = Some(text.to_string());
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    Ok(SongRecognizedMessage {
        artist_name: match &json_object["track"]["subtitle"] {
            Value::String(string) => string.to_string(),
            _ => {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    gettext("No match for this song").as_str(),
                )))
            }
        },
        album_name: album_name,
        song_name: match &json_object["track"]["title"] {
            Value::String(string) => string.to_string(),
            _ => {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    gettext("No match for this song").as_str(),
                )))
            }
        },
        cover_image: match pick_cover_url(&json_object) {
            Some(url) => Some(obtain_raw_cover_image(session.clone(), &url).await?),
            None => None,
        },
        recognition_engine: Some("songrec".to_string()),
        track_key: match &json_object["track"]["key"] {
            Value::String(string) => string.to_string(),
            _ => {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    gettext("No match for this song").as_str(),
                )))
            }
        },
        release_year: release_year,
        genre: match &json_object["track"]["genres"]["primary"] {
            Value::String(string) => Some(string.to_string()),
            _ => None,
        },
        shazam_json: Regex::new("\n *")
            .unwrap()
            .replace_all(
                &Regex::new("([,:])\n *")
                    .unwrap()
                    .replace_all(&to_string_pretty(&json_object).unwrap(), "$1 ")
                    .into_owned(),
                "",
            )
            .into_owned(),
    })
}

async fn recognize_best_song_from_signatures(
    session: &soup::Session,
    signatures: Vec<DecodedSignature>,
) -> Result<SongRecognizedMessage, Box<dyn Error>> {
    let mut recognized: Vec<SongRecognizedMessage> = Vec::new();
    let mut last_no_match: Option<Box<dyn Error>> = None;

    for signature in signatures {
        match try_recognize_song(session, signature).await {
            Ok(song) => recognized.push(song),
            Err(error) => {
                if error.to_string().as_str() == gettext("No match for this song") {
                    last_no_match = Some(error);
                    continue;
                }
                return Err(error);
            }
        }
    }

    if recognized.is_empty() {
        return Err(last_no_match.unwrap_or_else(|| {
            Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                gettext("No match for this song").as_str(),
            ))
        }));
    }

    let mut best_index = 0usize;
    let mut best_hits = 0usize;
    for (index, candidate) in recognized.iter().enumerate() {
        let hits = recognized
            .iter()
            .filter(|entry| entry.track_key == candidate.track_key)
            .count();
        if hits > best_hits {
            best_hits = hits;
            best_index = index;
        }
    }

    Ok(recognized.swap_remove(best_index))
}

pub async fn http_task(
    http_rx: async_channel::Receiver<HTTPMessage>,
    gui_tx: async_channel::Sender<GUIMessage>,
    microphone_tx: async_channel::Sender<MicrophoneMessage>,
) {
    let session = soup::Session::new();
    session.set_timeout(20);
    session.set_idle_timeout(2);

    // SongRec'e yakın davranış için ilk güçlü eşleşmede sonucu yayınla.
    // 2 olduğunda bazı cihazlarda tespit görünür şekilde gecikebiliyor.
    const REQUIRED_STABLE_HITS: u8 = 1;
    const STABLE_HIT_WINDOW: Duration = Duration::from_secs(45);
    let mut pending_track_key: String = String::new();
    let mut pending_track_hits: u8 = 0;
    let mut pending_track_at: Option<Instant> = None;
    let mut benchmark = RecognitionBenchmarkSnapshot::default();

    while let Ok(message) = http_rx.recv().await {
        let started_at = Instant::now();
        // XX USE SOUP3 CF. https://github.com/marin-m/Aurivo-Pulse/issues/223
        match message {
            HTTPMessage::ResetBenchmark => {
                benchmark = RecognitionBenchmarkSnapshot::default();
                send_benchmark_update(&gui_tx, &benchmark);
            }
            HTTPMessage::RecognizeSignature {
                signature,
                stabilize,
                source_file,
            } => {
                let (engine_mode, acoustid_key) = load_runtime_recognition_settings();
                if engine_mode == RecognitionEngineMode::AcoustIdOnly {
                    if let Some(ref file_path) = source_file {
                        match recognition::recognize_audio_file_with_acoustid(
                            file_path,
                            acoustid_key.as_deref(),
                        ) {
                            Ok(recognized_song) => {
                                gui_tx
                                    .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                    .unwrap();
                                let latency_ms = started_at.elapsed().as_millis() as u64;
                                update_benchmark_success(&mut benchmark, "AcoustID", latency_ms);
                                send_benchmark_update(&gui_tx, &benchmark);
                                gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                            }
                            Err(error) => {
                                gui_tx
                                    .try_send(GUIMessage::ErrorMessage(error.to_string()))
                                    .unwrap();
                                let latency_ms = started_at.elapsed().as_millis() as u64;
                                update_benchmark_failure(
                                    &mut benchmark,
                                    "acoustid-only error",
                                    latency_ms,
                                );
                                send_benchmark_update(&gui_tx, &benchmark);
                                gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                            }
                        }
                        let _ = microphone_tx.try_send(MicrophoneMessage::ProcessingDone);
                        continue;
                    }
                    gui_tx
                        .try_send(GUIMessage::ErrorMessage(
                            "AcoustID only mode requires a source file".to_string(),
                        ))
                        .unwrap();
                    let latency_ms = started_at.elapsed().as_millis() as u64;
                    update_benchmark_failure(
                        &mut benchmark,
                        "acoustid-only source missing",
                        latency_ms,
                    );
                    send_benchmark_update(&gui_tx, &benchmark);
                    let _ = microphone_tx.try_send(MicrophoneMessage::ProcessingDone);
                    continue;
                }
                match try_recognize_song(&session, *signature).await {
                    Ok(recognized_song) => {
                        let should_emit = if stabilize {
                            let now = Instant::now();
                            let same_track = !pending_track_key.is_empty()
                                && pending_track_key == recognized_song.track_key;
                            let inside_window = pending_track_at
                                .map(|t| now.duration_since(t) <= STABLE_HIT_WINDOW)
                                .unwrap_or(false);

                            if same_track && inside_window {
                                pending_track_hits = pending_track_hits.saturating_add(1);
                                pending_track_at = Some(now);
                            } else {
                                pending_track_key = recognized_song.track_key.clone();
                                pending_track_hits = 1;
                                pending_track_at = Some(now);
                            }

                            pending_track_hits >= REQUIRED_STABLE_HITS
                        } else {
                            true
                        };

                        if should_emit {
                            gui_tx
                                .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                .unwrap();
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_success(&mut benchmark, "SongRec", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            if stabilize {
                                pending_track_hits = 0;
                                pending_track_key.clear();
                                pending_track_at = None;
                            }
                        } else {
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "stabilizing", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                        }
                        gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                        gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                    }
                    Err(error) => match error.to_string().as_str() {
                        a if a == gettext("No match for this song") => {
                            if let Some(ref file_path) = source_file {
                                if engine_mode != RecognitionEngineMode::SongRecOnly
                                    && acoustid_key.is_some()
                                {
                                    match recognition::recognize_audio_file_with_acoustid(
                                        file_path,
                                        acoustid_key.as_deref(),
                                    ) {
                                        Ok(recognized_song) => {
                                            gui_tx
                                                .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                                .unwrap();
                                            let latency_ms = started_at.elapsed().as_millis() as u64;
                                            update_benchmark_success(
                                                &mut benchmark,
                                                "AcoustID",
                                                latency_ms,
                                            );
                                            send_benchmark_update(&gui_tx, &benchmark);
                                            gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                            gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                                            let _ = microphone_tx
                                                .try_send(MicrophoneMessage::ProcessingDone);
                                            continue;
                                        }
                                        Err(acoustid_error) => {
                                            log::warn!("AcoustID fallback failed: {:?}", acoustid_error);
                                        }
                                    }
                                }
                            }
                            if stabilize {
                                pending_track_hits = 0;
                                pending_track_key.clear();
                                pending_track_at = None;
                            }
                            gui_tx
                                .try_send(GUIMessage::ErrorMessage(error.to_string()))
                                .unwrap();
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "no-match", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                            gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                        }
                        a if a == gettext("Your IP has been rate-limited") => {
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "rate-limited", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::RateLimitState(true)).unwrap();
                        }
                        _ => {
                            log::error!("Network reach error: {:?}", error);
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(
                                &mut benchmark,
                                "network-unreachable",
                                latency_ms,
                            );
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::NetworkStatus(false)).unwrap();
                        }
                    },
                };
            }
            HTTPMessage::RecognizeSignatureBatch {
                signatures,
                stabilize,
                audio_batches,
            } => {
                let (engine_mode, acoustid_key) = load_runtime_recognition_settings();
                if engine_mode == RecognitionEngineMode::AcoustIdOnly {
                    if let Some(ref batches) = audio_batches {
                        match recognition::recognize_pcm_batches_with_acoustid(
                            batches.as_ref(),
                            16000,
                            1,
                            acoustid_key.as_deref(),
                        ) {
                            Ok(recognized_song) => {
                                gui_tx
                                    .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                    .unwrap();
                                let latency_ms = started_at.elapsed().as_millis() as u64;
                                update_benchmark_success(&mut benchmark, "AcoustID", latency_ms);
                                send_benchmark_update(&gui_tx, &benchmark);
                                gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                            }
                            Err(error) => {
                                gui_tx
                                    .try_send(GUIMessage::ErrorMessage(error.to_string()))
                                    .unwrap();
                                let latency_ms = started_at.elapsed().as_millis() as u64;
                                update_benchmark_failure(
                                    &mut benchmark,
                                    "acoustid-only error",
                                    latency_ms,
                                );
                                send_benchmark_update(&gui_tx, &benchmark);
                                gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                            }
                        }
                        let _ = microphone_tx.try_send(MicrophoneMessage::ProcessingDone);
                        continue;
                    }
                    gui_tx
                        .try_send(GUIMessage::ErrorMessage(
                            "AcoustID only mode requires raw audio batches".to_string(),
                        ))
                        .unwrap();
                    let latency_ms = started_at.elapsed().as_millis() as u64;
                    update_benchmark_failure(
                        &mut benchmark,
                        "acoustid-only batch missing",
                        latency_ms,
                    );
                    send_benchmark_update(&gui_tx, &benchmark);
                    let _ = microphone_tx.try_send(MicrophoneMessage::ProcessingDone);
                    continue;
                }
                match recognize_best_song_from_signatures(&session, *signatures).await {
                    Ok(recognized_song) => {
                        let should_emit = if stabilize {
                            let now = Instant::now();
                            let same_track = !pending_track_key.is_empty()
                                && pending_track_key == recognized_song.track_key;
                            let inside_window = pending_track_at
                                .map(|t| now.duration_since(t) <= STABLE_HIT_WINDOW)
                                .unwrap_or(false);

                            if same_track && inside_window {
                                pending_track_hits = pending_track_hits.saturating_add(1);
                                pending_track_at = Some(now);
                            } else {
                                pending_track_key = recognized_song.track_key.clone();
                                pending_track_hits = 1;
                                pending_track_at = Some(now);
                            }

                            pending_track_hits >= REQUIRED_STABLE_HITS
                        } else {
                            true
                        };

                        if should_emit {
                            gui_tx
                                .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                .unwrap();
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_success(&mut benchmark, "SongRec", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            if stabilize {
                                pending_track_hits = 0;
                                pending_track_key.clear();
                                pending_track_at = None;
                            }
                        } else {
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "stabilizing", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                        }
                        gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                        gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                    }
                    Err(error) => match error.to_string().as_str() {
                        a if a == gettext("No match for this song") => {
                            if let Some(ref batches) = audio_batches {
                                if engine_mode != RecognitionEngineMode::SongRecOnly
                                    && acoustid_key.is_some()
                                {
                                    match recognition::recognize_pcm_batches_with_acoustid(
                                        batches.as_ref(),
                                        16000,
                                        1,
                                        acoustid_key.as_deref(),
                                    ) {
                                        Ok(recognized_song) => {
                                            gui_tx
                                                .try_send(GUIMessage::SongRecognized(Box::new(recognized_song)))
                                                .unwrap();
                                            let latency_ms = started_at.elapsed().as_millis() as u64;
                                            update_benchmark_success(
                                                &mut benchmark,
                                                "AcoustID",
                                                latency_ms,
                                            );
                                            send_benchmark_update(&gui_tx, &benchmark);
                                            gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                                            gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                                            let _ = microphone_tx
                                                .try_send(MicrophoneMessage::ProcessingDone);
                                            continue;
                                        }
                                        Err(acoustid_error) => {
                                            log::warn!("AcoustID fallback failed: {:?}", acoustid_error);
                                        }
                                    }
                                }
                            }
                            if stabilize {
                                pending_track_hits = 0;
                                pending_track_key.clear();
                                pending_track_at = None;
                            }
                            gui_tx
                                .try_send(GUIMessage::ErrorMessage(error.to_string()))
                                .unwrap();
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "no-match", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::NetworkStatus(true)).unwrap();
                            gui_tx.try_send(GUIMessage::RateLimitState(false)).unwrap();
                        }
                        a if a == gettext("Your IP has been rate-limited") => {
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(&mut benchmark, "rate-limited", latency_ms);
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::RateLimitState(true)).unwrap();
                        }
                        _ => {
                            log::error!("Network reach error: {:?}", error);
                            let latency_ms = started_at.elapsed().as_millis() as u64;
                            update_benchmark_failure(
                                &mut benchmark,
                                "network-unreachable",
                                latency_ms,
                            );
                            send_benchmark_update(&gui_tx, &benchmark);
                            gui_tx.try_send(GUIMessage::NetworkStatus(false)).unwrap();
                        }
                    },
                };
            }
        }

        microphone_tx
            .try_send(MicrophoneMessage::ProcessingDone)
            .unwrap();
    }
}
