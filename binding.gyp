{
  "conditions": [
    ['OS=="win" and target_arch=="ia32"', {
        "targets": [ 
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [
            "wemeet_sdk/wemeet.cpp"
          ],
          'link_settings': {
            "libraries": ["-lwemeetsdk_x86"],
            'library_dirs': ['wemeet_sdk/win/lib/win32/release'],
          },
          "include_dirs": [
            "../../../include",
            "./include",
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [
                "/source-charset:utf-8",
                "/execution-charset:utf-8"
              ]
            }
          },
          #"defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }
	    ]
    }],
    ['OS=="win" and target_arch=="x64"', {
        "targets": [ 
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [
            "wemeet_sdk/wemeet.cpp"
          ],
          'link_settings': {
            "libraries": ["-lwemeetsdk_x64"],
            'library_dirs': ['wemeet_sdk/win/lib/x64/release'],
          },
          "include_dirs": [
            "../../../include",
            "./include",
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [
                "/source-charset:utf-8",
                "/execution-charset:utf-8"
              ]
            }
          },
          #"defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }
	    ]
    }],
    ['OS=="mac"', {
      "targets": [
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [ "wemeet_sdk/wemeet.cpp", "wemeet_sdk/mac/utils/log_utils.mm" ],
          "link_settings": {
            "libraries": [  
              "-framework TMSDK",
              # "-iframework wemeet_sdk/mac/Frameworks",
              # "-Wl,-rpath,wemeet_sdk/mac/Frameworks", 
              "-F../wemeet_sdk/mac/Frameworks/<(target_arch)/ -framework TMSDK"
              # '$(PWD)/mac/Frameworks/TMSDK.framework',
              ],
            "library_dirs" : ["../wemeet_sdk/mac/Frameworks/<(target_arch)/"],
          },
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "10.11",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_WEAK": "YES",
            "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
            "FRAMEWORK_SEARCH_PATHS": [
              "$(SDKROOT)/wemeet_sdk/mac/Frameworks/<(target_arch)/"
            ],
            "cflags":[
              "-std=c++11",
              "-stdlib=libc++",
              "-F=Release"
            ],

          },
          "include_dirs" : [
            'wemeet_sdk/mac/Frameworks/<(target_arch)/TMSDK.framework/Headers',
            "include",
            "wemeet_sdk/mac",
           ],
        }
      ]
    }]
  ]
}