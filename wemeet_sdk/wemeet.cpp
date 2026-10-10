#include <node_api.h>
#include <string>
#include <mutex>
#include <future>
#include <iostream>
#include <fstream>
#include <vector>
#include <map>
#include <functional>
#include <sstream>
#include "wemeet_sdk.h"
#include "wemeet_sdk_def.h"
#include "json/json.h"

#ifdef _WIN32
#include <Windows.h>
#endif // _WIN32
#ifdef __APPLE__
#include "utils/log_utils.h"
#include <unistd.h>       // for syscall()
#include <sys/syscall.h>  // for SYS_xxx definitions
#endif // __APPLE__

#define Assert(status) \
 if (status != napi_ok) log("napi error")

#define CHECK_NAPI_TYPE(paramDesc, function) \
  {paramDesc, std::bind(function, std::placeholders::_1, std::placeholders::_2)}

static const char *kUninitInfo = "{"
                                 "\"force\": true,"
                                 "}";

// 仅当 msg 是完整的 JSON 对象/数组时，才允许原样内联到回调 JSON 里。
// 形如 "enableX" is disabled by administrator 的文本，会被当成合法 JSON 字符串 "enableX" 解析成功而忽略尾随内容。若据此原样拼接，
// msg 自带的引号会破坏整条 JSON，导致渲染侧 JSON.parse 抛错、回调窗口丢消息。
bool inline JudgeMsgJson(const char *msg) {
  Json::Value root;
  Json::Reader reader;
  if (!reader.parse(msg, root)) {
    return false;
  }
  return root.isObject() || root.isArray();
}

// 使用 parseFromStream 函数
bool ParseJsonStringWithStream(const char* jsonStr, Json::Value& root) {
  Json::CharReaderBuilder builder;
  std::string errs;
  std::stringstream ss(jsonStr);

  return Json::parseFromStream(builder, ss, &root, &errs);
}

std::map<std::string, std::function<bool(napi_env, napi_value)>> check_napi_type;
std::string log_path;

#ifdef __APPLE__
std::string log_name = "/Global/Logs/wemeet_electron_demo.log";
#else
std::string log_name = "\\Logs\\wemeet_electron_demo.log";
#endif

void logHandle(std::string log, int tid) {
  std::ofstream ofs;
  time_t t = time(0);
  char tmp[64] = {0};
  strftime(tmp, sizeof(tmp), "[%Y-%m-%d %X]", localtime(&t));
  if (log_path.empty()) {
    ofs.open("wemeet_electron_demo.log", std::ofstream::app);
  } else {
    ofs.open(log_path, std::ofstream::app);
  }
  ofs << tmp << " - " << "[tid:" << tid << "] - " << log << std::endl;
  ofs.close();
}

void log(std::string log) {
#ifdef _WIN32
  try {
    DWORD tid = GetCurrentThreadId();
    logHandle(log, tid);
  } catch (...) {
  }
#endif
#ifdef __APPLE__
  int id = syscall(SYS_gettid);
  logHandle(log, id);
#endif
}


std::string UTF82Ansi(const std::string &strUtf8) {
#ifdef _WIN32
  int nWide = ::MultiByteToWideChar(CP_UTF8, 0, strUtf8.c_str(), strUtf8.size(), nullptr, 0);
  WCHAR* wbuffer = new WCHAR[nWide + 1];
  if (nullptr == wbuffer) {
    return "";
  }
  ::MultiByteToWideChar(CP_UTF8, 0, strUtf8.c_str(), strUtf8.size(), wbuffer, nWide);
  wbuffer[nWide] = L'\0';
  std::wstring strWide(wbuffer);
  delete[] wbuffer;
  int nUTF8 = ::WideCharToMultiByte(CP_ACP, 0, strWide.c_str(), strWide.length(), nullptr, 0, nullptr, nullptr);

  char* cbuffer = new char[nUTF8 + 1];
  if (nullptr == cbuffer) {
    return "";
  }
  ::WideCharToMultiByte(CP_ACP, 0, strWide.c_str(), strWide.size(), cbuffer, nUTF8, nullptr, nullptr);
  cbuffer[nUTF8] = '\0';
  std::string strUTF8(cbuffer);
  delete[] cbuffer;
  return std::move(strUTF8);
#else
  return std::move(strUtf8);
#endif
}

bool createFlagFile(const std::string &directory) {
  std::string fullPath = directory + "/flagFile";
  std::ofstream flagFile(fullPath);
  if (flagFile.is_open()) {
    flagFile.close();
    return true;
  } else {
    return false;
  }
}

void callJsLog(napi_env env, napi_value js_cb, void* context, void* data) {
  std::string *cb_msg = (std::string *)data;
  if (env == nullptr || cb_msg == nullptr)
    return;

  napi_value undefined, args[1];
  napi_create_string_utf8(env, cb_msg->c_str(), cb_msg->length(), &args[0]);
  napi_get_undefined(env, &undefined);
  auto s = napi_call_function(env, undefined, js_cb, 1, args, nullptr);
  Assert(s);
  delete cb_msg;
}

class QtPreMeetingCallback : public IPreMeetingCallback {
  void OnJoinMeeting(int code, const char *msg, const char *meeting_code) override;

  void OnActionResult(int action_type, int code, const char *msg) override;

  void OnShowAddressBook(int user_type, const char *msg) override;

  void OnRingInvitationEvent(int ring_state, const char *json_data) override;

  void OnVoiceRecordStatusChange(int ring_state, const char* msg) override;
};

class QtInMeetingCallback : public IInMeetingCallback {
  virtual void OnLeaveMeeting(int type, int code, const char *msg, const char *meeting_code);

  virtual void OnInviteMeeting(const char *invite_info);

  virtual void OnShowMeetingInfo(const char *meeting_info);

  virtual void OnQueryCustomOrgInfo(const char *json_data);

  virtual void OnInviteUsers(const char *json_data);

  virtual void OnActionResult(int action_type, int code, const char *msg);

  virtual void OnCaptionSwitchChanged(bool is_open);

  virtual void OnCaptionSettingChanged(const char *json_data);

  virtual void OnAudioStatusChanged(int audio_status);

  virtual void OnVideoStatusChanged(int video_status);
};


class WemmetElectronWrapper
    : public ISDKCallback, public IAuthenticationCallback, public QtPreMeetingCallback, public QtInMeetingCallback {
public:
  WemmetElectronWrapper() {
  }

  static WemmetElectronWrapper &GetElectronInstance() {
    static WemmetElectronWrapper *instance = nullptr;
    static std::once_flag token;
    if (instance != nullptr) {
      return *instance;
    }
    std::call_once(token, [&]() {
      auto tmp = new WemmetElectronWrapper();
      instance = tmp;
    });
    return *instance;
  }

  virtual ~WemmetElectronWrapper() {
//    if (wemeet_instance_) {
//      Uninitialize();
//    }
  }

public:
  void GetSDKVersion(char *buf, int buf_len) {
    GetWemeetSDKVersion(buf, buf_len);
  }

  bool Initialize(const InitParams &params) {
    if (wemeet_instance_) {
      auto code = wemeet_instance_->IsInitialized() ? kTMSDKErrorDuplicateInitCallAlreadyInitialized : kTMSDKErrorDuplicateInitCallWhenInitializing;
      ProcessCallbackMsg(std::string("OnSDKInitializeResult"), std::string("CommonService"), code, false, std::string("duplicate init call"), "");
      return true;
    }
    wemeet_instance_ = GetWemeetSDKInstance();
    if (!wemeet_instance_) {
      log("wemeet_instance_ is null");
      return false;
    }

    wemeet_instance_->Initialize(params, this);
    wemeet_instance_->GetAccountService()->SetCallback(this);
    wemeet_instance_->GetPreMeetingService()->SetCallback(this);
    wemeet_instance_->GetInMeetingService()->SetCallback(this);
    return true;
  }

  void Uninitialize(const char *params) {
    log(params);
    if (wemeet_instance_) {
      wemeet_instance_->Uninitialize(params);
    }
  }

  void SetNeedMeetingInfoCallback(bool enable, bool show) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->EnableMeetingInfoCallback(enable, show);
    }
  }

  void JumpUrlWithLoginStatus(const char *params) {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->JumpUrlWithLoginStatus(params);
    }
  }

  void HandleSchema(const char *params) {
    if (wemeet_instance_) {
      wemeet_instance_->HandleSchema(params);
    }
  }

  void ParseMeetingInfoUrl(const char *params) {
    if (wemeet_instance_) {
      wemeet_instance_->ParseMeetingInfoUrl(params);
    }
  }

  void GetUrlWithLoginStatus(const char *params, char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->GetUrlWithLoginStatus(params, buf, buf_len);
    }
  }

  void GetCurrentSDKToken(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetCurrentSDKToken(buf, buf_len);
    }
  }

  int RefreshSDKToken(const char *params) {
    if (wemeet_instance_) {
      return wemeet_instance_->RefreshSDKToken(params);
    }
    return kTMSDKErrorSdkNotInitialized;
  }

  void ShowHistoricalMeetingView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowHistoricalMeetingView();
    }
  }

  void ShowUploadLogsView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowUploadLogsView();
    }
  }

  void ShowMeetingDetailView(std::string meeting_id, std::string current_sub_meeting_id) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowMeetingDetailView(meeting_id.c_str(),
                                                                      current_sub_meeting_id.c_str());
    }
  }

  void ShowMeetingDetailView(std::string meeting_id, std::string current_sub_meeting_id, std::string start_time,
                             bool is_history) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowMeetingDetailView(meeting_id.c_str(),
                                                                      current_sub_meeting_id.c_str(),
                                                                      start_time.c_str(), is_history);
    }
  }

  void SetNeedShareCallback(bool enable, bool show) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->EnableInviteCallback(enable, show);
    }
  }

  void EnableAddressBookCallback(bool enable, bool show) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->EnableAddressBookCallback(enable, show);
    }
  }

  void EnableInviteUsersCallback(bool enable, bool show) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->EnableInviteUsersCallback(enable, show);
    }
  }

  void EnableCustomOrgInfo(bool enable) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->EnableCustomOrgInfo(enable);
    }
  }

  void ShowPreMeetingView(int ui_style, int tab_id) {
    WM_PRE_MEETING_VIEW_STYLE ui_style_home = ui_style > 0 ? WM_PRE_MEETING_VIEW_STYLE_TABS : WM_PRE_MEETING_VIEW_STYLE_CLASSIC;
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowPreMeetingView(ui_style_home, static_cast<PremeetingViewType>(tab_id));
    }
  }

  void Login(std::string sso_url) {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->Login(sso_url.c_str());
    }
  }

  void LoginByJSON(std::string login_json) {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->LoginByJSON(login_json.c_str());
    }
  }

  void Logout() {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->Logout();
    }
  }

  void QueryLocalRecordInfo(std::string meeting_id, std::string period_id) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->QueryLocalRecordInfo(meeting_id.c_str(), period_id.c_str());
    }
  }

  void ShowRecordFolder(std::string path_id) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowRecordFolder(path_id.c_str());
    }
  }

  void Transcode(std::string path_id) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->Transcode(path_id.c_str());
    }
  }

  void JoinMeeting(JoinMeetingParams params) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->JoinMeeting(params);
    }
  }

  void SetProxyInfo(const char *proxy_info) {
    if (wemeet_instance_) {
      wemeet_instance_->SetProxyInfo(UTF82Ansi(proxy_info).c_str());
    }
  }

  void GetProxyInfo(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetProxyInfo(buf, buf_len);
    }
  }


  void JoinMeetingByJSON(const char *join_meeting_json) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->JoinMeetingByJSON(UTF82Ansi(join_meeting_json).c_str());
    }
  }

  void QuickMeetingByJSON(const char *quick_meeting_json) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->QuickMeetingByJSON(UTF82Ansi(quick_meeting_json).c_str());
    }
  }

  void LeaveMeeting(int leave_meeting_type) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->LeaveMeeting(leave_meeting_type);
    }
  }

  void ShowJoinMeetingView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowJoinMeetingView();
    }
  }

  void ShowScheduleMeetingView(int meeting_type) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowScheduleMeetingView(meeting_type);
    }
  }

  void ShowMeetingSettingView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowMeetingSettingView();
    }
  }

// *** Debug Code Begin, These Code should only exist on dev_release ***
  void GetUserInfo(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetAccountService()->GetUserInfo(buf, buf_len);
    }
  }
// *** Debug Code End, These Code should only exist on dev_release ***

  void GetCurrentMeetingInfo(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->GetCurrentMeetingInfo(buf, buf_len);
    }
  }

  void GetScreenShareInfo(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->GetScreenShareInfo(buf, buf_len);
    }
  }

  void GetMeetingWindowInfo(char *buf, int buf_len) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->GetMeetingWindowInfo(buf, buf_len);
    }
  }

  void QuickMeeting() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->QuickMeeting();
    }
  }

  void QueryMeetingInfo(std::string data) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->QueryMeetingInfo(data.c_str());
    }
  }

  void SetCustomOrgInfo(std::string data) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->SetCustomOrgInfo(data.c_str());
    }
  }

  void AddUsersWithParam(std::string data) {
    if (wemeet_instance_) {
      wemeet_instance_->AddUsersWithParam(data.c_str());
    }
  }

  void ManipulateWindow(std::string data) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->ManipulateWindow(data.c_str());
    }
  }

  void FourceQuit() {
    if (wemeet_instance_) {
      wemeet_instance_->Uninitialize(kUninitInfo);
      wemeet_instance_ = nullptr;
    }
  }

  void ShowScreenCastView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowScreenCastView();
    }
  }

  void OpenLogDirectory() {
    if (wemeet_instance_) {
      wemeet_instance_->ShowLogs();
    }
  }

  uint64_t CollectLogFiles(std::string begin_time, std::string end_time, char *buf, int buf_len) {
    if (wemeet_instance_) {
      uint64_t beginTime = std::strtoull(begin_time.c_str(), nullptr, 10);
      uint64_t endTime = std::strtoull(end_time.c_str(), nullptr, 10);
      return wemeet_instance_->CollectLogFiles(beginTime, endTime, buf, buf_len);
    }
    return 0;
  }

  void ActiveUploadLogs(std::string begin_time, std::string end_time, std::string description) {
    if (wemeet_instance_) {
      uint64_t beginTime = std::strtoull(begin_time.c_str(), nullptr, 10);
      uint64_t endTime = std::strtoull(end_time.c_str(), nullptr, 10);
      wemeet_instance_->ActiveUploadLogs(beginTime, endTime, description.c_str());
    }
  }

  void BringInMeetingViewTop() {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->BringInMeetingViewTop();
    }
  }

  void DecodeUltrasoundScreenCastCode() {
    log(__FUNCTION__);
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->DecodeUltrasoundScreenCastCode();
    }
  }

  void DiscoverNearScreenCastCode(std::string cast_param) {
    log(__FUNCTION__);
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->DiscoverNearScreenCastCode(UTF82Ansi(cast_param).c_str());
    }
  }

  void StartScreenCast(std::string cast_param) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->StartScreenCast(UTF82Ansi(cast_param).c_str());
    }
  }

  void SetUserConfiguration(std::string user_key, std::string user_config) {
    if (wemeet_instance_) {
      wemeet_instance_->GetUserConfigService()->SetUserConfiguration(user_key.c_str(), user_config.c_str(),
      [](int code, const char* msg, void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
          std::string("SetUserConfiguration"), std::string("UserConfigService"),
          code, false, std::string(msg), ""
        );
      }, nullptr);
    }
  }

  void GetUserConfiguration(std::string user_key) {
    if (wemeet_instance_) {
      wemeet_instance_->GetUserConfigService()->GetUserConfiguration(user_key.c_str(),
      [](int code, const char* msg, const char* config_value, void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
          std::string("GetUserConfiguration"), std::string("UserConfigService"),
          code, false, std::string(config_value), ""
        );
      }, nullptr);
    }
  }
  
  void SetAppearanceMode(int mode) {
    if (wemeet_instance_) {
      wemeet_instance_->SetAppearanceMode(
          (SDKAppearanceMode)mode,
          [](int code, const char* msg, void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
            std::string("SetAppearanceMode"), std::string("CommonService"),
            code, false, std::string(msg), "");
      }, nullptr);
    }
  }

  void GetAppearanceMode() {
    if (wemeet_instance_) {
      wemeet_instance_->GetAppearanceMode(
          [](int code, const char* msg, const char* config_value,
             void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
            std::string("GetAppearanceMode"),
            std::string("CommonService"),
            code, false, std::string(config_value), "");
      }, nullptr);
    }
  }

  void DeleteVoicePrint() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->DeleteVoicePrint(
          [](int code, const char* msg, void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
            std::string("DeleteVoicePrint"), std::string("PreMeetingService"),
            code, false, std::string(msg), "");
      }, nullptr);
    }
  }

  void CheckVoicePrintIsCollected() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->CheckVoicePrintIsCollected(
          [](int code, const char* msg, const char* is_collected,
             void* user_data) {
        log(__FUNCTION__);
        Json::Value root;
        root["is_collected"] = is_collected ? is_collected : "";
        std::string param = Json::FastWriter().write(root);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
            std::string("CheckVoicePrintIsCollected"),
            std::string("PreMeetingService"),
            code, false, std::string(msg ? msg : ""), param);
      }, nullptr);
    }
  }

  void SetLeaveCastRoomActionType(int action_type) {
    if (action_type < kInMeetingLeaveCastRoomDefaultShowDialog || action_type > kInMeetingLeaveCastRoomStayInMeeting) {
      action_type = kInMeetingLeaveCastRoomDefaultShowDialog;
    }
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->SetLeaveCastRoomActionType(
          (InMeetingLeaveCastRoomActionType) action_type);
    }
  }

  void SwitchCaption(bool open) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->SwitchCaption(open, [](int code, const char *msg, void *user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
            std::string("SwitchCaption"),
            std::string("InMeetingService"),
            code,
            false,
            std::string(msg),
            ""
        );
      }, nullptr);
    }
  }

  void UpdateCaptionSettings(const char *settings_json) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->UpdateCaptionSettings(UTF82Ansi(settings_json).c_str(),
                                                                     [](int code, const char *msg, void *user_data) {
                                                                       log(__FUNCTION__);
                                                                       WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
                                                                           std::string("UpdateCaptionSettings"),
                                                                           std::string("InMeetingService"),
                                                                           code, false, std::string(msg), ""
                                                                       );
                                                                     }, nullptr);
    }
  }

  void ShowScreenShareView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->ShowScreenShareView([](int code, const char* msg, void* user_data) {
        log(__FUNCTION__);
        WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
          std::string("OnShowScreenShareView"), std::string("InMeetingService"), code, false, std::string(msg), ""
        );
      }, nullptr);
    }
  }

    void ShowVoiceRecordView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowVoiceRecordView();
    }
  }

  void ShowVoicePrintRecordView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowVoicePrintRecordView();
    }
  }

  void ShowAIAssistantView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowAIAssistantView();
    }
  }

  void ShowRoomsControllerView() {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->ShowRoomsControllerView();
    }
  }

  void EnableRingInvitationView(bool enable) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->EnableRingInvitationView(enable);
    }
  }

  void HandleRingInvitation(bool accept, std::string invite_id) {
    if (wemeet_instance_) {
      wemeet_instance_->GetPreMeetingService()->HandleRingInvitation(accept, invite_id.c_str(),
                                                                     [](int code, const char *msg, void *user_data) {
                                                                       log(__FUNCTION__);
                                                                       WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
                                                                           std::string("HandleRingInvitation"),
                                                                           std::string("PreMeetingService"), code,
                                                                           false, std::string(msg), "");
                                                                     }, nullptr);
    }
  }

  void SwitchLayout(const char *layout_json) {
    if (wemeet_instance_) {
      wemeet_instance_->GetInMeetingService()->SwitchLayout(UTF82Ansi(layout_json).c_str(),
                                                            [](int code, const char *msg, void *user_data) {
                                                              log(__FUNCTION__);
                                                              WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
                                                                  std::string("SwitchLayout"),
                                                                  std::string("InMeetingService"), code, false,
                                                                  std::string(msg), "");
                                                            }, nullptr);
    }
  }

  int SubscribeInMeetingActionEvent(int action_type, bool subscribe, const char *subscription_json) {
    if (wemeet_instance_) {
      return wemeet_instance_->GetInMeetingService()->SubscribeInMeetingActionEvent((WM_ActionType) action_type,
                                                                                    subscribe, subscription_json);
    }
    return kTMSDKErrorSdkNotInitialized;
  }

  void IsAuthorized() {
    log(__FUNCTION__);
    if (wemeet_instance_) {
      bool is_authorized = wemeet_instance_->GetAccountService()->IsLoggedIn();
      std::string is_authorized_str = is_authorized ? "1" : "0";
      log("IsAuthorized:" + is_authorized_str);
      Json::Value root;
      root["IsAuthorized"] = is_authorized_str;
      std::string param = Json::FastWriter().write(root);
      ProcessCallbackMsg(std::string("IsAuthorized"), std::string("AccountService"), is_authorized, false, "", param);
    }
  }

  void IsInitialized() {
    log(__FUNCTION__);
    bool is_initialized = false;
    if (wemeet_instance_) {
      is_initialized = wemeet_instance_->IsInitialized();
    }
    log("IsInitialized:" + std::to_string(is_initialized));
    Json::Value root;
    root["IsInitialized"] = std::to_string(is_initialized);
    std::string param = Json::FastWriter().write(root);
    ProcessCallbackMsg(std::string("IsInitialized"), std::string("CommonService"), is_initialized, false, "", param);
  }

  void OnSDKInitializeResult(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnSDKInitializeResult"), std::string("CommonService"), code, false,
                       std::string(msg), "");
  }

  void OnSDKUninitializeResult(int code, const char *msg) override {
    if (code == kTMSDKErrorSuccess) {
      wemeet_instance_ = nullptr;
      ReleaseWemeetSDKInstance();
    }
    ProcessCallbackMsg(std::string("OnSDKUninitializeResult"), std::string("CommonService"), code, false,
                       std::string(msg), "");
  }

  void OnParseMeetingInfoUrl(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnParseMeetingInfoUrl"), std::string("CommonService"), code, true, std::string(msg),
                       "");
  }

  void OnSDKError(int code, const char *msg) override {
    if (code < kTMSDKErrorAudioDeviceFailed) {
      wemeet_instance_ = nullptr;
    }
    ProcessCallbackMsg(std::string("OnSDKError"), std::string("CommonService"), code, false, std::string(msg), "");
  }

  void OnSDKTokenExpired(const char *sdk_token) override {
  }

  void OnResetSDKState(int code, const char *msg) override {
    if (code == kTMSDKErrorChildProcessCrash) {
      wemeet_instance_ = nullptr;
    }
    ProcessCallbackMsg(std::string("OnResetSDKState"), std::string("CommonService"), code, false, std::string(msg), "");
  }

  void OnShowLogsResult(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnShowLogsResult"), std::string("CommonService"), code, false, std::string(msg),
                       "");
  }

  void OnSetProxyResult(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnSetProxyResult"), std::string("CommonService"), code, false, std::string(msg),
                       "");
  }

  void OnActiveUploadLogsResult(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnActiveUploadLogsResult"), std::string("CommonService"), code, false,
                       std::string(msg), "");
  }

  void OnAddUsersResult(int user_type, int code, const char *msg) override {
    Json::Value root;
    root["user_type"] = std::to_string(user_type);
    std::string param = Json::FastWriter().write(root);
    ProcessCallbackMsg(std::string("OnAddUsersResult"), std::string("CommonService"), code, false, std::string(msg),
                       param);
  }

  void OnHandleSchemaResult(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnHandleSchemaResult"), std::string("CommonService"), code, false, std::string(msg),
                       "");
  }

  void OnLogin(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnLogin"), std::string("AccountService"), code, false, std::string(msg), "");
  }

  void OnLogout(int type, int code, const char *msg) override {
    Json::Value root;
    root["type"] = std::to_string(type);
    std::string param = Json::FastWriter().write(root);
    ProcessCallbackMsg(std::string("OnLogout"), std::string("AccountService"), code, false, std::string(msg), param);
  }

  void OnJumpUrlWithLoginStatus(int code, const char *msg) override {
    ProcessCallbackMsg(std::string("OnJumpUrlWithLoginStatus"), std::string("AccountService"), code, false,
                       std::string(msg), "");
  }


  void AddJsCallback(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value js_cb, work_name;
    napi_get_cb_info(env, info, &argc, &js_cb, nullptr, nullptr);
    napi_create_string_utf8(env,
                            "log callback",
                            NAPI_AUTO_LENGTH,
                            &work_name);
    napi_create_threadsafe_function(env,
                                    js_cb,
                                    nullptr,
                                    work_name,
                                    0,
                                    1,
                                    nullptr,
                                    nullptr,
                                    nullptr,
                                    callJsLog,
                                    &js_cb_);
  }

  //msg should be normal string, param should be json string
  void
  ProcessCallbackMsg(std::string func, std::string service, int code, bool json, std::string msg, std::string param) {
    Json::Value root;
    root["func"] = func;
    root["service"] = service;
    root["code"] = std::to_string(code);
    if (!msg.empty()) {
      Json::Value msgJson;
      if (ParseJsonStringWithStream(msg.c_str(), msgJson)) {
        root["msg"] = std::move(msgJson);
      } else {
        root["msg"] = msg;
      }
    }
    if (!param.empty()) {
      Json::Value paramJson;
      if (ParseJsonStringWithStream(param.c_str(), paramJson)) {
        root["param"] = paramJson;
      } else {
        root["param"] = param;
      }
    }
    std::string *jsonBody = new std::string();
    *jsonBody = Json::FastWriter().write(root);
    log(*jsonBody);
    if (js_cb_) {
      napi_acquire_threadsafe_function(js_cb_);
      napi_call_threadsafe_function(js_cb_, jsonBody, napi_tsfn_blocking);
    }
  }

private:
  napi_threadsafe_function js_cb_ = nullptr;
  IWemeetSDK *wemeet_instance_ = nullptr;
  std::string sso_url_;
  std::string id_token_;
};


void QtInMeetingCallback::OnLeaveMeeting(int type, int code, const char *msg, const char *meeting_code) {
  Json::Value root;
  root["type"] = std::to_string(type);
  root["meeting_code"] = meeting_code;
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnLeaveMeeting"), "InMeetingService",
                                                                  code, false, std::string(msg), param);
}

void QtInMeetingCallback::OnInviteMeeting(const char *invite_info) {
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnInviteMeeting"), "InMeetingService", 0,
                                                                  false, "", std::string(invite_info));
}

void QtInMeetingCallback::OnShowMeetingInfo(const char *meeting_info) {
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnShowMeetingInfo"), "InMeetingService",
                                                                  0, false, "", std::string(meeting_info));
}

void QtInMeetingCallback::OnActionResult(int action_type, int code, const char *msg) {
  Json::Value root;
  root["action_type"] = std::to_string(action_type);
  std::string param = Json::FastWriter().write(root);
  if (action_type == 1000) {
    WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnActionResult"), "InMeetingService",
                                                                    code, true, std::string(msg), param);
  } else {
    WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnActionResult"), "InMeetingService",
                                                                    code, false, std::string(msg), param);
  }
}

void QtInMeetingCallback::OnCaptionSwitchChanged(bool is_open) {
  Json::Value root;
  root["is_open"] = std::to_string(is_open);
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
    std::string("OnCaptionSwitchChanged"), "InMeetingService", 0, false, "", param);
}

void QtInMeetingCallback::OnCaptionSettingChanged(const char *json_data) {
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnCaptionSettingChanged"),
                                                                  "InMeetingService", 0, true, std::string(json_data),
                                                                  "");
}

void QtInMeetingCallback::OnQueryCustomOrgInfo(const char *msg) {
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnQueryCustomOrgInfo"),
                                                                  "InMeetingService", 0, true, std::string(msg), "");
}

void QtInMeetingCallback::OnInviteUsers(const char *msg) {
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
    std::string("OnInviteUsers"), "InMeetingService", 0, true, std::string(msg), "");
}

void QtInMeetingCallback::OnAudioStatusChanged(int audio_status) {
  Json::Value root;
  root["audio_status"] = std::to_string(audio_status);
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnAudioStatusChanged"),
                                                                  "InMeetingService", 0, false, "", param);
}

void QtInMeetingCallback::OnVideoStatusChanged(int video_status) {
  Json::Value root;
  root["video_status"] = std::to_string(video_status);
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnVideoStatusChanged"),
                                                                  "InMeetingService", 0, false, "", param);
}

void QtPreMeetingCallback::OnJoinMeeting(int code, const char *msg, const char *meeting_code) {
  Json::Value root;
  root["meeting_code"] = meeting_code;
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnJoinMeeting"), "PreMeetingService",
                                                                  code, false, std::string(msg), param);
}

void QtPreMeetingCallback::OnShowAddressBook(int user_type, const char *json_data) {
  Json::Value root;
  root["user_type"] = std::to_string(user_type);
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnShowAddressBook"), "PreMeetingService",
                                                                  0, true, std::string(json_data), param);
}

void QtPreMeetingCallback::OnRingInvitationEvent(int ring_state, const char *json_data) {
  Json::Value root;
  root["ring_state"] = std::to_string(ring_state);
  Json::Value jsonData;
  if (ParseJsonStringWithStream(json_data, jsonData)) {
    root["ring_info"] = jsonData;
  } else {
    root["ring_info"] = json_data;
  }
  std::string param = Json::FastWriter().write(root);
  WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(std::string("OnRingInvitationEvent"),
                                                                  "PreMeetingService", 0, false, "", param);
}

void QtPreMeetingCallback::OnVoiceRecordStatusChange(int voice_record_status, const char* json_data) {
    Json::Value root;
    root["voice_record_status"] = std::to_string(voice_record_status);
    Json::Value jsonData;
    if (ParseJsonStringWithStream(json_data, jsonData)) {
      root["voice_record_info"] = jsonData;
    } else {
      root["voice_record_info"] = json_data;
    }
    std::string param = Json::FastWriter().write(root);
    WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
      std::string("OnVoiceRecordStatusChange"), "PreMeetingService", 0, false, "", param
    );
}

void QtPreMeetingCallback::OnActionResult(int action_type, int code, const char *msg) {
  Json::Value root;
  root["action_type"] = std::to_string(action_type);
  std::string param = Json::FastWriter().write(root);
  if (action_type == 10) {
    WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
        std::string("OnActionResult"), "PreMeetingService", code, true, std::string(msg), param);
  } else {
    WemmetElectronWrapper::GetElectronInstance().ProcessCallbackMsg(
        std::string("OnActionResult"), "PreMeetingService", code, false, std::string(msg), param);
  }
}

napi_value GetSDKVersion(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetSDKVersion(buf, 4096);

  napi_create_string_utf8(env, buf, strlen(buf), &word);

  return word;
}

bool CheckNapiString(napi_env env, napi_value value) {
  napi_status status;
  napi_valuetype type;
  status = napi_typeof(env, value, &type);
  Assert(status);

  if (type != napi_string) {
    napi_throw_type_error(env, nullptr, "Wrong arguments");
    return false;
  }
  return true;
}

bool CheckNapiBool(napi_env env, napi_value value) {
  napi_valuetype type;
  napi_status status;
  status = napi_typeof(env, value, &type);
  Assert(status);

  if (type != napi_boolean) {
    napi_throw_type_error(env, nullptr, "Wrong arguments");
    return false;
  }
  return true;
}

std::string GetNapiString(napi_env env, napi_value value) {
  napi_status status;
  char buf[512] = {0};
  size_t len = 0;
  status = napi_get_value_string_utf8(env, value, buf, sizeof(buf), &len);
  Assert(status);
  std::string ret = buf;
  return ret;
}

bool GetNapiBool(napi_env env, napi_value value) {
  bool ret;
  napi_get_value_bool(env, value, &ret);
  return ret;
}

//sdk_id
//sdk_token
//data_path
//app_name
//language

static const size_t kSDKMiniInitParamsNumbers = 4;
#ifdef ENABLE_DEBUG_ABILITY
static const size_t kSDKMaxInitParamsNumbers = 13;
#else
static const size_t kSDKMaxInitParamsNumbers = 8;
#endif

napi_value InitWemeetSDK(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = kSDKMaxInitParamsNumbers;
  napi_value args[kSDKMaxInitParamsNumbers];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < kSDKMiniInitParamsNumbers) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }
  argc = argc > kSDKMaxInitParamsNumbers ? kSDKMaxInitParamsNumbers : argc;

  log("Args:");
  std::vector<std::string> vec_args(kSDKMaxInitParamsNumbers);
  for (size_t i = 0; i < argc; i++) {
    napi_valuetype type;
    status = napi_typeof(env, args[i], &type);
    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[4096] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[i], buf, sizeof(buf), &len);
    vec_args[i] = buf;
    log(buf);
  }

  InitParams params;
  params.sdk_id = vec_args[0].c_str();
  params.sdk_token = vec_args[1].c_str();
  params.data_path = vec_args[2].c_str();

  log("sdk_id:");
  log(params.sdk_id);
  log("sdk_token:");
  log(params.sdk_token);
  log("data_path:");
  log(params.data_path);

  size_t arg_index = 3;
  if (argc > arg_index) {
    params.app_name = vec_args[arg_index].c_str();
    arg_index++;
    log("app_name:");
    log(params.app_name);
  }
  if (argc > arg_index) {
    params.app_icon = vec_args[arg_index].c_str();
    arg_index++;
    log("app_icon:");
    log(params.app_icon);
  }
  if (argc > arg_index) {
    params.language = vec_args[arg_index].c_str();
    arg_index++;
    log("language:");
    log(params.language);
  }
  if (argc > arg_index) {
    params.proxy_info = vec_args[arg_index].c_str();
    arg_index++;
    log("proxy_info:");
    log(params.proxy_info);
  }
  if (argc > arg_index) {
    params.allow_home_view = (vec_args[arg_index] == "true");
    arg_index++;
    log("allow_home_view:");
    log(params.allow_home_view);
  }
#ifdef ENABLE_DEBUG_ABILITY
  if (argc > arg_index) {
    params.env_id = vec_args[arg_index].c_str();
    arg_index++;
    log("env_id:");
    log(params.env_id);
  }
  if (argc > arg_index) {
    params.env_name = vec_args[arg_index].c_str();
    arg_index++;
    log("env_name:");
    log(params.env_name);
  }
  if (argc > arg_index) {
    params.env_domain = vec_args[arg_index].c_str();
    arg_index++;
    log("env_domain:");
    log(params.env_domain);
  }
  if (argc > arg_index) {
    params.env_debug_mode = vec_args[arg_index].c_str();
    arg_index++;
    log("env_debug_mode:");
    log(params.env_debug_mode);
  }

  if (argc > arg_index) {
    params.env = vec_args[arg_index].c_str();
    log("env:");
    log(params.env);
  }
#endif

  #ifdef __APPLE__
    log_path = GetSandboxLibraryPath();
  #else
    log_path = params.data_path;
  #endif
  log_path = log_path + log_name;
  log("log_path:");
  log(log_path);

  if (createFlagFile(log_path)) {
    log("Flag file created successfully.");
  } else {
    log("Failed to create the flag file.");
  }

  auto code = kTMSDKErrorSuccess;
  log("start init sdk...");
  if (!WemmetElectronWrapper::GetElectronInstance().Initialize(params)) {
    log("init failed");
    code = kTMSDKErrorSdkNotInitialized;
  }
  log("init success");
  napi_value res;
  napi_create_uint32(env, code, &res);
  return res;
}

napi_value UninitWemeetSDK(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string uninit_param;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argument type");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    uninit_param = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().Uninitialize(uninit_param.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

static const size_t kSDKGoToHome = 2;

napi_value ShowPreMeetingView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = kSDKGoToHome;
  napi_value args[kSDKGoToHome];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);
  if (argc < kSDKGoToHome) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string ui_style = "0";
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      log("type");
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }
    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    ui_style = buf;
  }

  std::string tab_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    Assert(status);
    tab_id = buf;
  }
  WemmetElectronWrapper::GetElectronInstance().ShowPreMeetingView(atoi(ui_style.c_str()), atoi(tab_id.c_str()));
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SubscribeInMeetingActionEvent(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = 3;
  napi_value args[3];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);
  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string action_type = "0";
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      log("type");
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }
    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    action_type = buf;
  }

  bool subscribe = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[1], &subscribe);
  }

  std::string subscription_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[2], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[2], buf, sizeof(buf), &len);
    subscription_json = buf;
  }

  int ans = WemmetElectronWrapper::GetElectronInstance().SubscribeInMeetingActionEvent(
      atoi(action_type.c_str()), subscribe, subscription_json.c_str());
  napi_value res;
  napi_create_int32(env, ans, &res);
  return res;
}

napi_value IsAuthorized(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().IsAuthorized();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value IsInitialized(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().IsInitialized();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

//end_meeting
static const size_t kSDKLeaveMeetingParamsNumbers = 1;

napi_value LeaveMeeting(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = kSDKLeaveMeetingParamsNumbers;
  napi_value args[kSDKLeaveMeetingParamsNumbers];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);
  if (argc < kSDKLeaveMeetingParamsNumbers) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  int leave_meeting_type = 0;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    if (type != napi_number) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    napi_get_value_int32(env, args[0], &leave_meeting_type);
  }
  log(leave_meeting_type);
  WemmetElectronWrapper::GetElectronInstance().LeaveMeeting(leave_meeting_type);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}


//meeting_code = "";
//user_display_name = "";
//password = "";
//mic_on = false;
//camera_on = true;
//speaker_on = false;
//face_beauty_on = true;
static const size_t kSDKJoinMeetingParamsNumbers = 9;

napi_value JoinMeeting(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  check_napi_type = {
      CHECK_NAPI_TYPE("meeting_code", CheckNapiString),
      CHECK_NAPI_TYPE("user_display_name", CheckNapiString),
      CHECK_NAPI_TYPE("password", CheckNapiString),
      CHECK_NAPI_TYPE("invite_url", CheckNapiString),
      CHECK_NAPI_TYPE("mic_on", CheckNapiBool),
      CHECK_NAPI_TYPE("camera_on", CheckNapiBool),
      CHECK_NAPI_TYPE("speaker_on", CheckNapiBool),
      CHECK_NAPI_TYPE("face_beauty_on", CheckNapiBool),
      CHECK_NAPI_TYPE("meetingtitle", CheckNapiString)
  };

  napi_status status;
  size_t argc = kSDKJoinMeetingParamsNumbers;
  napi_value args[kSDKJoinMeetingParamsNumbers];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < kSDKJoinMeetingParamsNumbers) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }
  std::string meeting_code, user_display_name, password, invite_url, meetingtitle;
  bool mic_on = false, camera_on = false, speaker_on = false, face_beauty_on = false;
  if (check_napi_type["meeting_code"](env, args[0]))
    meeting_code = GetNapiString(env, args[0]);
  if (check_napi_type["user_display_name"](env, args[1]))
    user_display_name = GetNapiString(env, args[1]);
  if (check_napi_type["password"](env, args[2]))
    password = GetNapiString(env, args[2]);
  if (check_napi_type["invite_url"](env, args[3]))
    invite_url = GetNapiString(env, args[3]);
  if (check_napi_type["mic_on"](env, args[4]))
    mic_on = GetNapiBool(env, args[4]);
  if (check_napi_type["camera_on"](env, args[5]))
    camera_on = GetNapiBool(env, args[5]);
  if (check_napi_type["speaker_on"](env, args[6]))
    speaker_on = GetNapiBool(env, args[6]);
  if (check_napi_type["face_beauty_on"](env, args[7]))
    face_beauty_on = GetNapiBool(env, args[7]);
  if (check_napi_type["meetingtitle"](env, args[8]))
    meetingtitle = GetNapiString(env, args[8]);
  JoinMeetingParams params;
  params.meeting_code = meeting_code.c_str();
  params.camera_on = camera_on;
  params.mic_on = mic_on;
  params.speaker_on = speaker_on;
  params.user_display_name = user_display_name.c_str();
  params.password = password.c_str();
  params.face_beauty_on = face_beauty_on;
  params.invite_url = invite_url.c_str();
  params.meeting_window_title = meetingtitle.c_str();

  WemmetElectronWrapper::GetElectronInstance().JoinMeeting(params);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SetProxyInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string proxy_info;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    proxy_info = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().SetProxyInfo(proxy_info.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value GetProxyInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetProxyInfo(buf, 4096);
  napi_create_string_utf8(env, buf, strlen(buf), &word);
  return word;
}

napi_value JoinMeetingByJSON(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string join_meeting_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    join_meeting_json = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().JoinMeetingByJSON(join_meeting_json.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value QuickMeetingByJSON(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string quick_meeting_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    quick_meeting_json = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().QuickMeetingByJSON(quick_meeting_json.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SwitchLayout(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string layout_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    layout_json = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().SwitchLayout(layout_json.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value LoginByJSON(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string login_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[1024] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    login_json = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().LoginByJSON(login_json.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

//sso_url
//id_token
static const size_t kSDKLoginParamsNumbers = 1;

napi_value Login(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = kSDKLoginParamsNumbers;
  napi_value args[kSDKLoginParamsNumbers];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < kSDKLoginParamsNumbers) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string sso_url;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[4096] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    sso_url = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().Login(sso_url);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value Logout(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().Logout();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowScreenCastView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().ShowScreenCastView();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value JumpUrlWithLoginStatus(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string url_jump;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    url_jump = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().JumpUrlWithLoginStatus(url_jump.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value HandleSchema(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string sheme_url;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    sheme_url = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().HandleSchema(sheme_url.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ParseMeetingInfoUrl(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string sheme_url;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    sheme_url = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().ParseMeetingInfoUrl(sheme_url.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value GetUrlWithLoginStatus(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string url_jump;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    url_jump = buf;
  }

  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetUrlWithLoginStatus(url_jump.c_str(), buf, 4096);

  napi_create_string_utf8(env, buf, strlen(buf), &word);

  return word;
}

napi_value GetCurrentSDKToken(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetCurrentSDKToken(buf, 4096);

  napi_create_string_utf8(env, buf, strlen(buf), &word);

  return word;
}

napi_value RefreshSDKToken(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string new_token;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    new_token = buf;
  }

  napi_value res;
  int ans = WemmetElectronWrapper::GetElectronInstance().RefreshSDKToken(new_token.c_str());
  napi_create_int32(env, ans, &res);

  return res;
}

napi_value ShowMeetingDetailView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 4;
  napi_value args[4];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string meeting_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    meeting_id = buf;
  }

  std::string current_sub_meeting_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    current_sub_meeting_id = buf;
  }

  if (argc == 4) {
    bool is_history;
    {
      napi_valuetype type;
      status = napi_typeof(env, args[3], &type);

      if (type != napi_boolean) {
        napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
        return nullptr;
      }
      napi_get_value_bool(env, args[3], &is_history);
    }

    std::string start_time;
    {
      napi_valuetype type;
      status = napi_typeof(env, args[2], &type);

      if (type != napi_string) {
        napi_throw_type_error(env, nullptr, "Wrong arguments");
        return nullptr;
      }

      char buf[512] = {0};
      size_t len = 0;
      status = napi_get_value_string_utf8(env, args[2], buf, sizeof(buf), &len);
      start_time = buf;
    }
    WemmetElectronWrapper::GetElectronInstance().ShowMeetingDetailView(meeting_id, current_sub_meeting_id, start_time,
                                                                       is_history);
  } else {
    WemmetElectronWrapper::GetElectronInstance().ShowMeetingDetailView(meeting_id, current_sub_meeting_id);
  }
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ActiveUploadLogs(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  check_napi_type = {
      CHECK_NAPI_TYPE("begin_time", CheckNapiString),
      CHECK_NAPI_TYPE("end_time", CheckNapiString),
      CHECK_NAPI_TYPE("description", CheckNapiString),
  };
  napi_status status;
  size_t argc = 3;
  napi_value args[3];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 3) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }
  std::string begin_time, end_time, description;
  if (check_napi_type["begin_time"](env, args[0]))
    begin_time = GetNapiString(env, args[0]);
  if (check_napi_type["end_time"](env, args[1]))
    end_time = GetNapiString(env, args[1]);
  if (check_napi_type["description"](env, args[2]))
    description = GetNapiString(env, args[2]);
  WemmetElectronWrapper::GetElectronInstance().ActiveUploadLogs(begin_time, end_time, description);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}


napi_value CollectLogFiles(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  std::string begin_time;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }
    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    begin_time = buf;
  }

  std::string end_time;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);
    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    end_time = buf;
  }
  char buf[4096] = {0};
  napi_value res;
  int buffer_size = WemmetElectronWrapper::GetElectronInstance().CollectLogFiles(begin_time, end_time, buf, 4096);

  if (buffer_size > 4096) {
    char *buffer_out = new char[buffer_size];
    memset(buffer_out, 0, buffer_size);
    WemmetElectronWrapper::GetElectronInstance().CollectLogFiles(begin_time, end_time, buffer_out, buffer_size);
    napi_create_string_utf8(env, buffer_out, buffer_size - 1, &res);
    delete[] buffer_out;
  } else {
    napi_create_string_utf8(env, buf, buffer_size - 1, &res);
  }
  return res;
}

napi_value ShowJoinMeetingView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowJoinMeetingView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowScheduleMeetingView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool schedule_meetint_type;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }
    napi_get_value_bool(env, args[0], &schedule_meetint_type);
    log(schedule_meetint_type ? "1" : "0");
  }

  WemmetElectronWrapper::GetElectronInstance().ShowScheduleMeetingView(schedule_meetint_type);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowMeetingSettingView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowMeetingSettingView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

// *** Debug Code Begin, These Code should only exist on dev_release ***
napi_value GetUserInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetUserInfo(buf, 4096);
  napi_create_string_utf8(env, buf, strlen(buf), &word);
  return word;
}
// *** Debug Code End, These Code should only exist on dev_release ***

napi_value GetCurrentMeetingInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetCurrentMeetingInfo(buf, 4096);
  napi_create_string_utf8(env, buf, strlen(buf), &word);
  return word;
}

napi_value GetScreenShareInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetScreenShareInfo(buf, 4096);
  napi_create_string_utf8(env, buf, strlen(buf), &word);
  return word;
}

napi_value GetMeetingWindowInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value word;
  char buf[4096] = {0};
  WemmetElectronWrapper::GetElectronInstance().GetMeetingWindowInfo(buf, 4096);
  napi_create_string_utf8(env, buf, strlen(buf), &word);
  return word;
}

napi_value QuickMeeting(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().QuickMeeting();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value QueryMeetingInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().QueryMeetingInfo(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SetCustomOrgInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().SetCustomOrgInfo(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value DecodeUltrasoundScreenCastCode(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().DecodeUltrasoundScreenCastCode();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value DiscoverNearScreenCastCode(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().DiscoverNearScreenCastCode(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value StartScreenCast(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().StartScreenCast(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SetUserConfiguration(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string user_key;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    user_key = buf;
  }

  std::string user_config;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    Assert(status);
    user_config = buf;
  }


  WemmetElectronWrapper::GetElectronInstance().SetUserConfiguration(user_key, user_config);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value GetUserConfiguration(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string user_key;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    user_key = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().GetUserConfiguration(user_key);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SetAppearanceMode(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }
  std::string mode;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);
    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }
    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    mode = buf;
  }
  WemmetElectronWrapper::GetElectronInstance().SetAppearanceMode(atoi(mode.c_str()));
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}
napi_value GetAppearanceMode(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().GetAppearanceMode();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}
napi_value DeleteVoicePrint(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().DeleteVoicePrint();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}
napi_value CheckVoicePrintIsCollected(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().CheckVoicePrintIsCollected();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}
napi_value SetLeaveCastRoomActionType(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string action_type = "0";
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      log("type");
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }
    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    action_type = buf;
  }
  WemmetElectronWrapper::GetElectronInstance().SetLeaveCastRoomActionType(atoi(action_type.c_str()));
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SwitchCaption(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool open = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &open);
  }

  WemmetElectronWrapper::GetElectronInstance().SwitchCaption(open);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}


napi_value UpdateCaptionSettings(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string settings_json;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong argumentsxx");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    settings_json = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().UpdateCaptionSettings(settings_json.c_str());
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}


napi_value ShowScreenShareView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowScreenShareView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowVoiceRecordView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowVoiceRecordView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowVoicePrintRecordView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowVoicePrintRecordView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowAIAssistantView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowAIAssistantView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowRoomsControllerView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_value res;
  WemmetElectronWrapper::GetElectronInstance().ShowRoomsControllerView();
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value EnableRingInvitationView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  WemmetElectronWrapper::GetElectronInstance().EnableRingInvitationView(enable);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value HandleRingInvitation(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool accept = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &accept);
  }

  std::string invite_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    invite_id = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().HandleRingInvitation(accept, invite_id);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value AddUsersWithParam(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().AddUsersWithParam(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ManipulateWindow(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().ManipulateWindow(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value QueryLocalRecordInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string meeting_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    meeting_id = buf;
  }

  std::string period_id;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[1], buf, sizeof(buf), &len);
    Assert(status);
    period_id = buf;
  }


  WemmetElectronWrapper::GetElectronInstance().QueryLocalRecordInfo(meeting_id, period_id);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowRecordFolder(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    Assert(status);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().ShowRecordFolder(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value Transcode(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  napi_status status;
  napi_value res;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  std::string data;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);
    Assert(status);

    if (type != napi_string) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    char buf[512] = {0};
    size_t len = 0;
    status = napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
    data = buf;
  }

  WemmetElectronWrapper::GetElectronInstance().Transcode(data);
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowHistoricalMeetingView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().ShowHistoricalMeetingView();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value ShowUploadLogsView(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().ShowUploadLogsView();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value OpenLogDirectory(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().OpenLogDirectory();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value BringInMeetingViewTop(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);
  WemmetElectronWrapper::GetElectronInstance().BringInMeetingViewTop();
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value SetNeedShareCallback(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  bool show = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[1], &show);
  }

  WemmetElectronWrapper::GetElectronInstance().SetNeedShareCallback(enable, show);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value EnableAddressBookCallback(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  bool show = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[1], &show);
  }

  WemmetElectronWrapper::GetElectronInstance().EnableAddressBookCallback(enable, show);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value EnableInviteUsersCallback(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  bool show = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[1], &show);
  }

  WemmetElectronWrapper::GetElectronInstance().EnableInviteUsersCallback(enable, show);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value EnableCustomOrgInfo(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments, need boolean type");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  WemmetElectronWrapper::GetElectronInstance().EnableCustomOrgInfo(enable);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}


napi_value SetNeedMeetingInfoCallback(napi_env env, napi_callback_info info) {
  log(__FUNCTION__);

  napi_status status;
  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Assert(status);

  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  bool enable = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[0], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    napi_get_value_bool(env, args[0], &enable);
  }

  bool show = false;
  {
    napi_valuetype type;
    status = napi_typeof(env, args[1], &type);

    if (type != napi_boolean) {
      napi_throw_type_error(env, nullptr, "Wrong arguments");
      return nullptr;
    }

    napi_get_value_bool(env, args[1], &show);
  }

  WemmetElectronWrapper::GetElectronInstance().SetNeedMeetingInfoCallback(enable, show);
  napi_value res;
  napi_create_uint32(env, kTMSDKErrorSuccess, &res);
  return res;
}

napi_value AddJsCallback(napi_env env, napi_callback_info info) {
  WemmetElectronWrapper::GetElectronInstance().AddJsCallback(env, info);
  return nullptr;
}

#define DECLARE_NAPI_METHOD(name, func) { name, 0, func, 0, 0, 0, napi_default, 0 }

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc;
  napi_status status;

  desc = DECLARE_NAPI_METHOD("GetSDKVersion", GetSDKVersion);
  status = napi_define_properties(env, exports, 1, &desc);
  Assert(status);

  desc = DECLARE_NAPI_METHOD("InitWemeetSDK", InitWemeetSDK);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("UninitWemeetSDK", UninitWemeetSDK);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("IsInitialized", IsInitialized);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetNeedMeetingInfoCallback", SetNeedMeetingInfoCallback);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetNeedShareCallback", SetNeedShareCallback);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("EnableAddressBookCallback", EnableAddressBookCallback);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("EnableInviteUsersCallback", EnableInviteUsersCallback);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("EnableCustomOrgInfo", EnableCustomOrgInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowPreMeetingView", ShowPreMeetingView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("Login", Login);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("LoginByJSON", LoginByJSON);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("Logout", Logout);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("JoinMeeting", JoinMeeting);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetProxyInfo", SetProxyInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetProxyInfo", GetProxyInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("JoinMeetingByJSON", JoinMeetingByJSON);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("QuickMeetingByJSON", QuickMeetingByJSON);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowScreenCastView", ShowScreenCastView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("OpenLogDirectory", OpenLogDirectory);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("BringInMeetingViewTop", BringInMeetingViewTop);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("LeaveMeeting", LeaveMeeting);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("IsAuthorized", IsAuthorized);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("JumpUrlWithLoginStatus", JumpUrlWithLoginStatus);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetCurrentSDKToken", GetCurrentSDKToken);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetUrlWithLoginStatus", GetUrlWithLoginStatus);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("RefreshSDKToken", RefreshSDKToken);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowHistoricalMeetingView", ShowHistoricalMeetingView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowMeetingDetailView", ShowMeetingDetailView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("CollectLogFiles", CollectLogFiles);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowJoinMeetingView", ShowJoinMeetingView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowScheduleMeetingView", ShowScheduleMeetingView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowMeetingSettingView", ShowMeetingSettingView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("HandleSchema", HandleSchema);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ParseMeetingInfoUrl", ParseMeetingInfoUrl);
  status = napi_define_properties(env, exports, 1, &desc);
// *** Debug Code Begin, These Code should only exist on dev_release ***
  desc = DECLARE_NAPI_METHOD("GetUserInfo", GetUserInfo);
  status = napi_define_properties(env, exports, 1, &desc);
// *** Debug Code End, These Code should only exist on dev_release ***

  desc = DECLARE_NAPI_METHOD("GetCurrentMeetingInfo", GetCurrentMeetingInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetScreenShareInfo", GetScreenShareInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetMeetingWindowInfo", GetMeetingWindowInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("QuickMeeting", QuickMeeting);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("QueryMeetingInfo", QueryMeetingInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetCustomOrgInfo", SetCustomOrgInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("AddUsersWithParam", AddUsersWithParam);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ManipulateWindow", ManipulateWindow);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("QueryLocalRecordInfo", QueryLocalRecordInfo);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowRecordFolder", ShowRecordFolder);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("Transcode", Transcode);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("DecodeUltrasoundScreenCastCode", DecodeUltrasoundScreenCastCode);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("DiscoverNearScreenCastCode", DiscoverNearScreenCastCode);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("StartScreenCast", StartScreenCast);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetLeaveCastRoomActionType", SetLeaveCastRoomActionType);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SwitchCaption", SwitchCaption);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("UpdateCaptionSettings", UpdateCaptionSettings);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowUploadLogsView", ShowUploadLogsView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ActiveUploadLogs", ActiveUploadLogs);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("EnableRingInvitationView", EnableRingInvitationView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("HandleRingInvitation", HandleRingInvitation);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SwitchLayout", SwitchLayout);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowScreenShareView", ShowScreenShareView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowVoiceRecordView", ShowVoiceRecordView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowVoicePrintRecordView", ShowVoicePrintRecordView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("ShowAIAssistantView", ShowAIAssistantView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetUserConfiguration", SetUserConfiguration);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("GetUserConfiguration", GetUserConfiguration);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SetAppearanceMode", SetAppearanceMode);
  status = napi_define_properties(env, exports, 1, &desc);
  desc = DECLARE_NAPI_METHOD("GetAppearanceMode", GetAppearanceMode);
  status = napi_define_properties(env, exports, 1, &desc);
  desc = DECLARE_NAPI_METHOD("DeleteVoicePrint", DeleteVoicePrint);
  status = napi_define_properties(env, exports, 1, &desc);
  desc = DECLARE_NAPI_METHOD("CheckVoicePrintIsCollected", CheckVoicePrintIsCollected);
  status = napi_define_properties(env, exports, 1, &desc);
  desc = DECLARE_NAPI_METHOD("ShowRoomsControllerView", ShowRoomsControllerView);
  status = napi_define_properties(env, exports, 1, &desc);

  desc = DECLARE_NAPI_METHOD("SubscribeInMeetingActionEvent", SubscribeInMeetingActionEvent);
  status = napi_define_properties(env, exports, 1, &desc);

  napi_value fn;
  status = napi_create_function(env, nullptr, 0, AddJsCallback, nullptr, &fn);
  status = napi_set_named_property(env, exports, "AddJsCallback", fn);
  Assert(status);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
