{
  "targets": [
    {
      "target_name": "wemeet_electron_sdk",
      "sources": ["native/wemeet.cpp"],
      "include_dirs": ["sdk/linux-arm64/3.26.100.14/include"],
      "conditions": [
        ["OS==\"linux\" and target_arch==\"arm64\"", {
          "link_settings": {
            "libraries": ["-Wl,-rpath,'$$ORIGIN'", "-Wl,-z,origin", "-lwemeetsdk"],
            "library_dirs": ["<(module_root_dir)/sdk/linux-arm64/3.26.100.14"]
          },
          "cflags_cc": ["-fexceptions"],
          "defines": ["NAPI_CPP_EXCEPTIONS"]
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
