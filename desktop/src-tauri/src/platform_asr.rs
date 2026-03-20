use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::{Arc, Mutex, OnceLock};
use tracing::info;

#[derive(Debug, Clone)]
pub struct NativeAsrError {
    pub code: String,
    pub message: Option<String>,
}

impl NativeAsrError {
    #[cfg(not(target_os = "macos"))]
    fn unsupported() -> Self {
        Self {
            code: "speech_not_supported".to_string(),
            message: Some("Native ASR is unavailable on this platform".to_string()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NativeAsrSegmentEvent {
    pub text: String,
    pub locale: Option<String>,
    pub confidence: Option<f32>,
}

type NativeAsrCallback = Arc<dyn Fn(NativeAsrSegmentEvent) + Send + Sync + 'static>;

fn callback_slot() -> &'static Mutex<Option<NativeAsrCallback>> {
    static CALLBACK: OnceLock<Mutex<Option<NativeAsrCallback>>> = OnceLock::new();
    CALLBACK.get_or_init(|| Mutex::new(None))
}

pub fn set_segment_callback(callback: Option<NativeAsrCallback>) {
    if let Ok(mut slot) = callback_slot().lock() {
        *slot = callback;
    }
}

#[no_mangle]
pub extern "C" fn coworkany_native_asr_on_segment(
    text: *const c_char,
    locale: *const c_char,
    confidence: f32,
) {
    if text.is_null() {
        return;
    }

    let value = unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .trim()
        .to_string();
    if value.is_empty() {
        return;
    }

    let callback = callback_slot().lock().ok().and_then(|slot| slot.clone());
    if let Some(callback) = callback {
        let locale_value = if locale.is_null() {
            None
        } else {
            Some(
                unsafe { CStr::from_ptr(locale) }
                    .to_string_lossy()
                    .into_owned(),
            )
        };

        callback(NativeAsrSegmentEvent {
            text: value,
            locale: locale_value,
            confidence: if confidence.is_finite() {
                Some(confidence)
            } else {
                None
            },
        });
    }
}

#[no_mangle]
pub extern "C" fn coworkany_native_asr_log(message: *const c_char) {
    if message.is_null() {
        return;
    }

    let value = unsafe { CStr::from_ptr(message) }
        .to_string_lossy()
        .trim()
        .to_string();
    if value.is_empty() {
        return;
    }

    info!("native_asr {}", value);
}

#[cfg(target_os = "macos")]
mod imp {
    use super::NativeAsrError;
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    unsafe extern "C" {
        fn coworkany_macos_native_asr_is_supported() -> bool;
        fn coworkany_macos_native_asr_start(
            locale: *const c_char,
            error_code: *mut *mut c_char,
            error_message: *mut *mut c_char,
        ) -> bool;
        fn coworkany_macos_native_asr_stop(
            transcript: *mut *mut c_char,
            error_code: *mut *mut c_char,
            error_message: *mut *mut c_char,
        ) -> bool;
        fn coworkany_macos_native_asr_free_string(value: *mut c_char);
    }

    fn take_owned_string(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }

        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { coworkany_macos_native_asr_free_string(ptr) };
        Some(value)
    }

    pub fn is_supported() -> bool {
        unsafe { coworkany_macos_native_asr_is_supported() }
    }

    pub fn start(language: Option<&str>) -> Result<(), NativeAsrError> {
        let locale = language
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| CString::new(value).ok());

        let mut error_code: *mut c_char = std::ptr::null_mut();
        let mut error_message: *mut c_char = std::ptr::null_mut();
        let success = unsafe {
            coworkany_macos_native_asr_start(
                locale
                    .as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                &mut error_code,
                &mut error_message,
            )
        };

        if success {
            return Ok(());
        }

        Err(NativeAsrError {
            code: take_owned_string(error_code).unwrap_or_else(|| "native_asr_failed".to_string()),
            message: take_owned_string(error_message),
        })
    }

    pub fn stop() -> Result<String, NativeAsrError> {
        let mut transcript: *mut c_char = std::ptr::null_mut();
        let mut error_code: *mut c_char = std::ptr::null_mut();
        let mut error_message: *mut c_char = std::ptr::null_mut();
        let success = unsafe {
            coworkany_macos_native_asr_stop(&mut transcript, &mut error_code, &mut error_message)
        };

        if success {
            return Ok(take_owned_string(transcript).unwrap_or_default());
        }

        Err(NativeAsrError {
            code: take_owned_string(error_code).unwrap_or_else(|| "native_asr_failed".to_string()),
            message: take_owned_string(error_message),
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::NativeAsrError;

    pub fn is_supported() -> bool {
        false
    }

    pub fn start(_language: Option<&str>) -> Result<(), NativeAsrError> {
        Err(NativeAsrError::unsupported())
    }

    pub fn stop() -> Result<String, NativeAsrError> {
        Err(NativeAsrError::unsupported())
    }
}

pub fn is_supported() -> bool {
    imp::is_supported()
}

pub fn start(language: Option<&str>) -> Result<(), NativeAsrError> {
    imp::start(language)
}

pub fn stop() -> Result<String, NativeAsrError> {
    imp::stop()
}
