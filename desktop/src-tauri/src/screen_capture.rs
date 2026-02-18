
use screenshots::Screen;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use std::io::Cursor;

pub struct ScreenCapture;

impl ScreenCapture {
    pub fn capture_primary() -> Result<String, String> {
        let screens = Screen::all().map_err(|e| e.to_string())?;
        let screen = screens.first().ok_or("No screen found")?;
        
        // Capture
        let image = screen.capture().map_err(|e| e.to_string())?;
        
        // Convert to PNG in memory
        let mut buffer = Cursor::new(Vec::new());
        image.write_to(&mut buffer, image::ImageOutputFormat::Png)
            .map_err(|e| e.to_string())?;
            
        // Encode to base64
        let encoded = BASE64.encode(buffer.get_ref());
        Ok(encoded)
    }
}

#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    ScreenCapture::capture_primary()
}
