{
    "targets": [
        {
            "target_name": "ardali_audio",
            "sources": ["ardali_audio.cpp", "ardali_dsp.cpp"],
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "../libs/bass/c",
                "../libs/bass_fx/c"
            ],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
            
            "conditions": [
                ["OS=='linux'", {
                    "cflags!": ["-fno-exceptions"],
                    "cflags_cc!": ["-fno-exceptions"],
                    "cflags_cc": ["-std=c++17", "-fexceptions"],
                    "libraries": [
                        "-L<(module_root_dir)/../libs/linux",
                        "-lbass",
                        "-lbass_fx",
                        "-lbass_aac",
                        "-lbassape",
                        "-lbassflac",
                        "-lbasswv",
                        "-Wl,-rpath,'$$ORIGIN'",
                        "-Wl,-rpath,'$$ORIGIN/..'",
                        "-Wl,-rpath,'$$ORIGIN/../libs/linux'",
                        "-Wl,--enable-new-dtags"
                    ],
                    "ldflags": [
                        "-Wl,-rpath,'$$ORIGIN'",
                        "-Wl,-rpath,'$$ORIGIN/..'",
                        "-Wl,-rpath,'$$ORIGIN/../libs/linux'"
                    ]
                }],
                
                ["OS=='win'", {
                    "defines": ["WIN32", "_WINDOWS", "NOMINMAX", "WIN32_LEAN_AND_MEAN"],
                    "libraries": [
                        "<(module_root_dir)/../libs/windows/bass.lib",
                        "<(module_root_dir)/../libs/windows/bass_fx.lib"
                    ],
                    "msvs_settings": {
                        "VCCLCompilerTool": {
                            "ExceptionHandling": 1,
                            "AdditionalOptions": [
                                "/std:c++17"
                            ]
                        }
                    }
                }],
                
                ["OS=='mac'", {
                    "cflags!": ["-fno-exceptions"],
                    "cflags_cc!": ["-fno-exceptions"],
                    "cflags_cc": ["-std=c++17", "-fexceptions"],
                    "libraries": [
                        "-L<(module_root_dir)/../libs/macos",
                        "-lbass",
                        "-lbass_fx",
                        "-Wl,-rpath,@loader_path",
                        "-Wl,-rpath,@loader_path/.."
                    ],
                    "xcode_settings": {
                        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                        "CLANG_CXX_LIBRARY": "libc++",
                        "MACOSX_DEPLOYMENT_TARGET": "10.15"
                    }
                }]
            ]
        }
    ]
}
