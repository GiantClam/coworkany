fn main() {
    #[cfg(target_os = "macos")]
    println!("cargo:rerun-if-changed=native/macos_asr.m");

    #[cfg(target_os = "macos")]
    {
        let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR must be set");
        cc::Build::new()
            .file("native/macos_asr.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("coworkany_macos_asr");

        println!("cargo:rustc-link-search=native={out_dir}");
        println!("cargo:rustc-link-lib=static=coworkany_macos_asr");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop={out_dir}/libcoworkany_macos_asr.a");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=-framework");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=Foundation");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=-framework");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=Speech");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=-framework");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=AVFoundation");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=-framework");
        println!("cargo:rustc-link-arg-bin=coworkany-desktop=CoreMedia");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Speech");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
    }

    tauri_build::build();
}
