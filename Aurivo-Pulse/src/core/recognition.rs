use reqwest::blocking::Client;
use rodio::{Decoder, Source};
use serde_json::Value;
use async_channel::{Receiver, Sender};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::error::Error;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::fs::File;
use std::io::BufReader;
use std::time::Duration;

use crate::core::http_task::http_task;
use crate::core::processing_thread::processing_thread;
use crate::core::thread_messages::SongRecognizedMessage;
use crate::core::thread_messages::{
    spawn_big_thread, GUIMessage, HTTPMessage, MicrophoneMessage, ProcessingMessage,
};

#[repr(C)]
struct ChromaprintContext {
    _private: [u8; 0],
}

#[link(name = "chromaprint")]
unsafe extern "C" {
    fn chromaprint_new(algorithm: c_int) -> *mut ChromaprintContext;
    fn chromaprint_free(ctx: *mut ChromaprintContext);
    fn chromaprint_start(
        ctx: *mut ChromaprintContext,
        sample_rate: c_int,
        num_channels: c_int,
    ) -> c_int;
    fn chromaprint_feed(ctx: *mut ChromaprintContext, data: *const i16, size: c_int) -> c_int;
    fn chromaprint_finish(ctx: *mut ChromaprintContext) -> c_int;
    fn chromaprint_get_fingerprint(ctx: *mut ChromaprintContext, fingerprint: *mut *mut c_char)
        -> c_int;
    fn chromaprint_dealloc(ptr: *mut c_void);
}

const ACOUSTID_LOOKUP_URL: &str = "https://api.acoustid.org/v2/lookup";
const CHROMAPRINT_ALGO_DEFAULT: c_int = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecognitionEngineMode {
    Hybrid,
    SongRecOnly,
    AcoustIdOnly,
}

impl RecognitionEngineMode {
    pub fn from_preference_value(value: Option<&str>) -> Self {
        match value.unwrap_or("hybrid").trim().to_lowercase().as_str() {
            "songrec_only" | "songrec-only" | "songrec" => Self::SongRecOnly,
            "acoustid_only" | "acoustid-only" | "acoustid" => Self::AcoustIdOnly,
            _ => Self::Hybrid,
        }
    }

    pub fn as_preference_value(self) -> &'static str {
        match self {
            Self::Hybrid => "hybrid",
            Self::SongRecOnly => "songrec_only",
            Self::AcoustIdOnly => "acoustid_only",
        }
    }

    pub fn ui_badge(self) -> &'static str {
        match self {
            Self::Hybrid => "Hybrid",
            Self::SongRecOnly => "SongRec",
            Self::AcoustIdOnly => "AcoustID",
        }
    }
}

#[derive(Clone, Debug)]
struct AcoustIdMatch {
    acoustid_id: String,
    artist_name: String,
    song_name: String,
    album_name: Option<String>,
    score: f64,
    raw_json: String,
}

pub fn acoustid_client_key_from_env() -> Option<String> {
    std::env::var("AURIVO_ACOUSTID_API_KEY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn resolve_acoustid_client_key(preferred: Option<&str>) -> Option<String> {
    preferred
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(acoustid_client_key_from_env)
}

pub fn launch_recognition_pipeline(
    processing_rx: Receiver<ProcessingMessage>,
    http_tx: Sender<HTTPMessage>,
    gui_tx_for_processing: Sender<GUIMessage>,
    http_rx: Receiver<HTTPMessage>,
    gui_tx_for_http: Sender<GUIMessage>,
    microphone_tx: Sender<MicrophoneMessage>,
) {
    spawn_big_thread(move || {
        processing_thread(processing_rx, http_tx, gui_tx_for_processing);
    });

    glib::spawn_future_local(http_task(http_rx, gui_tx_for_http, microphone_tx));
}

pub fn recognize_audio_file_with_acoustid(
    file_path: &str,
    api_key: Option<&str>,
) -> Result<SongRecognizedMessage, Box<dyn Error>> {
    let (pcm_data, sample_rate, channels, duration_secs) = decode_audio_file_to_pcm_i16(file_path)?;
    let fingerprint = fingerprint_from_pcm_i16(&pcm_data, sample_rate, channels)?;
    let acoustid = lookup_acoustid(&fingerprint, duration_secs, api_key)?;
    Ok(to_song_message(acoustid))
}

pub fn recognize_pcm_batches_with_acoustid(
    batches: &[Vec<i16>],
    sample_rate: u32,
    channels: u8,
    api_key: Option<&str>,
) -> Result<SongRecognizedMessage, Box<dyn Error>> {
    let mut best: Option<AcoustIdMatch> = None;

    for samples in batches.iter().take(3) {
        if samples.is_empty() {
            continue;
        }
        let duration_secs = ((samples.len() as f64) / f64::from(sample_rate) / f64::from(channels))
            .round()
            .max(1.0) as u32;
        let fingerprint =
            fingerprint_from_pcm_i16(samples, sample_rate as i32, channels as i32)?;
        let matched = lookup_acoustid(&fingerprint, duration_secs, api_key)?;
        if best
            .as_ref()
            .map(|existing| matched.score > existing.score)
            .unwrap_or(true)
        {
            best = Some(matched);
        }
    }

    match best {
        Some(matched) => Ok(to_song_message(matched)),
        None => Err("AcoustID no match".into()),
    }
}

fn decode_audio_file_to_pcm_i16(
    file_path: &str,
) -> Result<(Vec<i16>, i32, i32, u32), Box<dyn Error>> {
    let file = File::open(file_path)?;
    let decoder = Decoder::new(BufReader::new(file))?;
    let sample_rate = decoder.sample_rate() as i32;
    let channels = decoder.channels() as i32;
    let estimated_duration_secs = decoder.total_duration().map(|d| d.as_secs()).unwrap_or(0);
    let pcm_data: Vec<i16> = decoder.convert_samples::<i16>().collect();
    if pcm_data.is_empty() {
        return Err("AcoustID fingerprint error: no PCM data".into());
    }

    let fallback_duration =
        ((pcm_data.len() as f64) / f64::from(sample_rate) / f64::from(channels))
            .round()
            .max(1.0) as u32;
    let duration_secs = if estimated_duration_secs > 0 {
        estimated_duration_secs as u32
    } else {
        fallback_duration
    };

    Ok((pcm_data, sample_rate, channels, duration_secs))
}

fn fingerprint_from_pcm_i16(
    pcm_data: &[i16],
    sample_rate: i32,
    channels: i32,
) -> Result<String, Box<dyn Error>> {
    if pcm_data.is_empty() {
        return Err("AcoustID fingerprint error: empty input".into());
    }
    if sample_rate <= 0 || channels <= 0 {
        return Err("AcoustID fingerprint error: invalid audio params".into());
    }

    let ctx = unsafe { chromaprint_new(CHROMAPRINT_ALGO_DEFAULT) };
    if ctx.is_null() {
        return Err("AcoustID fingerprint error: chromaprint_new failed".into());
    }

    let result = (|| -> Result<String, Box<dyn Error>> {
        let ok = unsafe { chromaprint_start(ctx, sample_rate as c_int, channels as c_int) };
        if ok != 1 {
            return Err("AcoustID fingerprint error: chromaprint_start failed".into());
        }
        let ok = unsafe { chromaprint_feed(ctx, pcm_data.as_ptr(), pcm_data.len() as c_int) };
        if ok != 1 {
            return Err("AcoustID fingerprint error: chromaprint_feed failed".into());
        }
        let ok = unsafe { chromaprint_finish(ctx) };
        if ok != 1 {
            return Err("AcoustID fingerprint error: chromaprint_finish failed".into());
        }

        let mut fp_ptr: *mut c_char = std::ptr::null_mut();
        let ok = unsafe { chromaprint_get_fingerprint(ctx, &mut fp_ptr) };
        if ok != 1 || fp_ptr.is_null() {
            return Err("AcoustID fingerprint error: chromaprint_get_fingerprint failed".into());
        }

        let fingerprint = unsafe { CStr::from_ptr(fp_ptr) }
            .to_string_lossy()
            .to_string();
        unsafe { chromaprint_dealloc(fp_ptr as *mut c_void) };
        if fingerprint.trim().is_empty() {
            return Err("AcoustID fingerprint error: empty fingerprint".into());
        }
        Ok(fingerprint)
    })();

    unsafe { chromaprint_free(ctx) };
    result
}

fn lookup_acoustid(
    fingerprint: &str,
    duration: u32,
    api_key: Option<&str>,
) -> Result<AcoustIdMatch, Box<dyn Error>> {
    let api_key = resolve_acoustid_client_key(api_key)
        .ok_or_else(|| "AcoustID API key missing (AURIVO_ACOUSTID_API_KEY)".to_string())?;

    let mut form: HashMap<&str, String> = HashMap::new();
    form.insert("client", api_key);
    form.insert("meta", "recordings+releasegroups".to_string());
    form.insert("duration", duration.to_string());
    form.insert("fingerprint", fingerprint.to_string());

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let response_text = client.post(ACOUSTID_LOOKUP_URL).form(&form).send()?.text()?;
    let json: Value = serde_json::from_str(&response_text)?;
    parse_best_match(&json).ok_or_else(|| "AcoustID no match".into())
}

fn parse_best_match(json: &Value) -> Option<AcoustIdMatch> {
    if json.get("status")?.as_str()? != "ok" {
        return None;
    }

    let best_result = json
        .get("results")?
        .as_array()?
        .iter()
        .filter_map(|entry| {
            let score = entry.get("score").and_then(Value::as_f64).unwrap_or(0.0);
            let acoustid_id = entry.get("id").and_then(Value::as_str)?.to_string();
            let recording = entry.get("recordings")?.as_array()?.first()?;
            let song_name = recording.get("title").and_then(Value::as_str)?.to_string();
            let artist_name = recording
                .get("artists")
                .and_then(Value::as_array)
                .and_then(|artists| artists.first())
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown artist")
                .to_string();
            let album_name = recording
                .get("releasegroups")
                .and_then(Value::as_array)
                .and_then(|groups| groups.first())
                .and_then(|group| group.get("title"))
                .and_then(Value::as_str)
                .map(|v| v.to_string());

            Some(AcoustIdMatch {
                acoustid_id,
                artist_name,
                song_name,
                album_name,
                score,
                raw_json: serde_json::to_string(json).unwrap_or_else(|_| "{}".to_string()),
            })
        })
        .max_by(|left, right| left.score.partial_cmp(&right.score).unwrap_or(Ordering::Equal))?;

    Some(best_result)
}

fn to_song_message(matched: AcoustIdMatch) -> SongRecognizedMessage {
    SongRecognizedMessage {
        artist_name: matched.artist_name,
        album_name: matched.album_name,
        song_name: matched.song_name,
        cover_image: None,
        track_key: format!("acoustid:{}", matched.acoustid_id),
        release_year: None,
        genre: None,
        shazam_json: matched.raw_json,
        recognition_engine: Some("acoustid".to_string()),
    }
}
