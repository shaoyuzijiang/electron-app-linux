{
  "conditions": [
    ['OS=="win" and target_arch=="ia32"', {
        "targets": [ 
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [
            "wemeet_sdk/wemeet.cpp",
            "wemeet_sdk/jsoncpp.cpp"
          ],
          'link_settings': {
            "libraries": ["-lwemeetsdk_x86"],
            'library_dirs': ['wemeet_sdk/win/lib/win32/release'],
          },
          "include_dirs": [
            "wemeet_sdk/win/include",
            "./include",
            "./include/json",
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [
                "/source-charset:utf-8",
                "/execution-charset:utf-8"
              ],
              "DebugInformationFormat": "3"
            },
            "VCLinkerTool": {
              "GenerateDebugInformation": "true"
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
            "wemeet_sdk/wemeet.cpp",
            "wemeet_sdk/jsoncpp.cpp"
          ],
          'link_settings': {
            "libraries": ["-lwemeetsdk_x64"],
            'library_dirs': ['wemeet_sdk/win/lib/x64/release'],
          },
          "include_dirs": [
            "wemeet_sdk/win/include",
            "./include",
            "./include/json",
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [
                "/source-charset:utf-8",
                "/execution-charset:utf-8"
              ],
              "DebugInformationFormat": "3"
            },
            "VCLinkerTool": {
              "GenerateDebugInformation": "true"
            }
          },
          #"defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }
	    ]
    }],
    ['OS=="mac" and target_arch=="arm64"', {
      "targets": [
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [ "wemeet_sdk/wemeet.cpp", "wemeet_sdk/jsoncpp.cpp", "wemeet_sdk/mac/utils/log_utils.mm" ],
          "link_settings": {
            "libraries": [  
              "-framework TMSDK",
              "-F../wemeet_sdk/mac/Frameworks/arm64/ -framework TMSDK"
              ],
            "library_dirs" : ["../wemeet_sdk/mac/Frameworks/arm64/"],
          },
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "10.11",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_WEAK": "YES",
            "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
            "FRAMEWORK_SEARCH_PATHS": [
              "$(SDKROOT)/wemeet_sdk/mac/Frameworks/arm64/"
            ],
            "cflags":[
              "-std=c++11",
              "-stdlib=libc++",
              "-F=Release"
            ],

          },
          "include_dirs" : [
            'wemeet_sdk/mac/Frameworks/arm64/TMSDK.framework/Headers',
            "include",
            "include/json",
            "wemeet_sdk/mac",
           ],
        }
      ]
    }],
    ['OS=="mac" and target_arch=="x64"', {
      "targets": [
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [ "wemeet_sdk/wemeet.cpp", "wemeet_sdk/jsoncpp.cpp", "wemeet_sdk/mac/utils/log_utils.mm" ],
          "link_settings": {
            "libraries": [  
              "-framework TMSDK",
              "-F../wemeet_sdk/mac/Frameworks/x86_64/ -framework TMSDK"
              ],
            "library_dirs" : ["../wemeet_sdk/mac/Frameworks/x86_64/"],
          },
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "10.11",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_ENABLE_OBJC_WEAK": "YES",
            "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
            "FRAMEWORK_SEARCH_PATHS": [
              "$(SDKROOT)/wemeet_sdk/mac/Frameworks/x86_64/"
            ],
            "cflags":[
              "-std=c++11",
              "-stdlib=libc++",
              "-F=Release"
            ],

          },
          "include_dirs" : [
            'wemeet_sdk/mac/Frameworks/x86_64/TMSDK.framework/Headers',
            "include",
            "include/json",
            "wemeet_sdk/mac",
           ],
        }
      ]
    }],
    ['OS=="linux" and target_arch=="arm64"', {
      "targets": [
        {
          "target_name": "wemeet_electron_sdk",
          "sources": [ "native/linux/wemeet.cpp" ],
          "include_dirs": [ "native/include" ],
          "libraries": [ "-Wl,-rpath,'$$ORIGIN'", "-Wl,-rpath,'$$ORIGIN/Release/lib'", "-Wl,-z,origin", "-lwemeetsdk" ],
          "library_dirs": [ "<(module_root_dir)/output/linux" ],
          "cflags_cc!": [ "-std=gnu++20" ],
          "cflags_cc": [ "-fexceptions", "-std=gnu++2a" ]
        }
      ]
    }]
  ]
}