import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// Client for the OnlineLotto API (the same Express server as the admin web dashboard). Admins
// sign in with their OnlineLotto admin account and every call carries its JWT. The server address defaults to --dart-define=API_URL=... at build time and
// can be changed on the login screen (⚙). The built-in address is the online server.
class ApiException implements Exception {
  final String message;
  final int status;
  ApiException(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

class Api {
  Api._();
  static final Api instance = Api._();

  static const _serverKey = 'online_server_url';
  static const _tokenKey = 'online_token';
  static const _rememberKey = 'online_remember_username'; // set while "Remember me" is on
  static const _brandUserKey = 'online_brand_user';
  static const _brandLogoKey = 'online_brand_logo';
  static const defaultServer = String.fromEnvironment('API_URL', defaultValue: 'https://online-lottosale-multifilesystem.onrender.com');
  // Addresses saved by older builds that talked to a computer on the desk. Those now follow the online server.
  static const _localDefaults = {'http://10.0.2.2:3000', 'http://127.0.0.1:3000', 'http://localhost:3000'};

  String _server = defaultServer;
  String? _token;
  // Username to fill in on the login screen ("Remember me" was on at the last sign-in).
  String rememberedUsername = '';
  // Last master logo shown for a username, so the next visit can paint it before the server answers.
  String brandUser = '';
  String? brandLogo;
  // Called when the server rejects the token (expired / account closed) so the app can sign out.
  void Function()? onUnauthorized;

  String get server => _server;
  String? get token => _token;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_serverKey);
    _server = (saved == null || _localDefaults.contains(saved)) ? defaultServer : saved;
    if (_server != saved) await prefs.setString(_serverKey, _server);
    _token = prefs.getString(_tokenKey);
    rememberedUsername = prefs.getString(_rememberKey) ?? '';
    brandUser = prefs.getString(_brandUserKey) ?? '';
    brandLogo = prefs.getString(_brandLogoKey);
  }

  Future<void> saveBrandLogo(String username, String? logo) async {
    brandUser = username;
    brandLogo = (logo == null || logo.isEmpty) ? null : logo;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_brandUserKey, username);
    if (brandLogo == null) {
      await prefs.remove(_brandLogoKey);
    } else {
      await prefs.setString(_brandLogoKey, brandLogo!);
    }
  }

  Future<void> setServer(String url) async {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    if (u.isNotEmpty && !u.startsWith('http://') && !u.startsWith('https://')) u = 'http://$u';
    _server = u.isEmpty ? defaultServer : u;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverKey, _server);
  }

  // persist: false ("Remember me" off) keeps the sign-in for this run of the app only.
  Future<void> setToken(String? token, {bool persist = true}) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    if (token == null || !persist) {
      await prefs.remove(_tokenKey);
    } else {
      await prefs.setString(_tokenKey, token);
    }
  }

  Future<void> setRememberedUsername(String? username) async {
    rememberedUsername = username ?? '';
    final prefs = await SharedPreferences.getInstance();
    if (username == null || username.isEmpty) {
      await prefs.remove(_rememberKey);
    } else {
      await prefs.setString(_rememberKey, username);
    }
  }

  // Server messages (English) shown in Myanmar where we know them — same list as the web app.
  static const _messages = {
    'Invalid username or password': 'အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားနေသည်',
    'Account is not active': 'အကောင့် ပိတ်ထားသည်',
    'Invalid or expired token': 'ဝင်ရောက်မှု သက်တမ်းကုန်သွားပြီ၊ ပြန်ဝင်ပါ',
    'Insufficient balance': 'လက်ကျန်ငွေ မလုံလောက်ပါ',
    'Betting is closed for this term': 'ဤအပါတ်စဥ်အတွက် ထိုးကြေး ပိတ်ပြီးဖြစ်သည်',
    'Validation failed': 'ဖြည့်သွင်းချက် မှားနေသည်',
    'Current password is wrong': 'လက်ရှိ စကားဝှက် မှားနေသည်',
    'Nothing to save: every number is closed, full or at its limit': 'ထိုးထားသော ဂဏန်း တစ်ကွက်မှ မရပါ (ပိတ်ဂဏန်း / ဘရိတ်ပြည့် / ကန့်သတ်ချက်ပြည့်) — စလစ် မသိမ်းပါ',
    'Betting has not closed yet': 'ထိုးကြေး မပိတ်ရသေးပါ',
    'Username already taken': 'အသုံးပြုသူအမည် ရှိပြီးသား ဖြစ်သည်',
    'Enter results before settling (term must be "drawn")': 'ငွေမရှင်းမီ ပေါက်ဂဏန်း အရင်ထည့်ပါ',
    'Only closed, settled or cancelled terms can be deleted': 'ပိတ်ပြီး၊ ငွေရှင်းပြီး သို့မဟုတ် ပယ်ဖျက်ထားသော အပါတ်စဥ်များသာ ဖျက်နိုင်သည်',
    'A folder with this name already exists': 'ဤအမည်ဖြင့် ဖိုင် ရှိပြီးသားဖြစ်သည်',
    'Folder not found': 'ဖိုင် မတွေ့ပါ',
    'Cannot delete a folder that has open terms': 'ဖွင့်ထားသော အပါတ်စဥ် ပါသော ဖိုင်ကို ဖျက်မရပါ',
    'Cannot delete all terms while a term is open': 'ဖွင့်ထားသော အပါတ်စဥ် ရှိနေသေး၍ အပါတ်စဥ်အားလုံးကို ဖျက်မရပါ',
    'Only settled folders can be deleted': 'ငွေရှင်းပြီးသော ဖိုင်များကိုသာ ဖျက်နိုင်သည်',
    'Download the Excel backup first': 'ဖျက်ခင် Excel + PDF backup အရင်ထုတ်ရပါမည် — web admin တွင် ဖျက်ပါ',
    'Saving over the unit break is not allowed': 'ဘရိတ်ကျော်၍ သိမ်းရန် ခွင့်မပြုထားပါ',
    'Only the admin can allow saving over the unit break': 'အကျွံများသိမ်းကို Admin သာ ခွင့်ပြုနိုင်သည်',
    'Over-break save is for master, agent and user accounts': 'အကျွံများသိမ်းသည် Master / Agent / User အကောင့်များအတွက်သာ ဖြစ်သည်',
    'Only accounts with role "user" can hold tickets': 'User အကောင့်များသာ စလစ် ထိုးနိုင်သည်',
    'Name already exists': 'ဤအမည် ရှိပြီးသားဖြစ်သည်',
    'Prize set is still assigned to accounts': 'ဤအဆကို အကောင့်များ သုံးနေသေးသည် — အရင် ဖြုတ်ပါ',
    'This prize set pays more than your own odds': 'ဤအဆသည် သင့်အဆထက် ပိုပေးသည်',
    'Prize sets are for user accounts': 'ဆုအဆ အစုသည် ထိုးသား (user) အကောင့်များအတွက်သာ ဖြစ်သည်',
    'A delete request for this slip is already waiting': 'ဤစလစ်အတွက် ဖျက်ရန် request ပို့ထားပြီး',
    'Term already has results': 'ပေါက်ဂဏန်း ထွက်ပြီး၍ ဖျက်မရပါ',
    'Hot number edit is not enabled': 'ဟော့ဂဏန်း ပြင်ခွင့် မရှိပါ',
    'Only the admin can allow editing hot numbers': 'ဟော့ဂဏန်း ပြင်ခွင့်ကို Admin သာ ပေးနိုင်သည်',
    'Hot number edit is for master accounts': 'ဟော့ဂဏန်း ပြင်ခွင့်သည် Master အကောင့်များအတွက်သာ ဖြစ်သည်',
    'A master can only change agent and user accounts': 'Master သည် သူ့အောက်က Agent / User ကိုသာ Role ပြောင်းနိုင်သည်',
    'A master can only set the agent or user role': 'Master သည် Agent သို့မဟုတ် User အဖြစ်သာ ပြောင်းနိုင်သည်',
    'That upline is outside your accounts': 'အဲဒီအထက်အကောင့်သည် သင့်အောက်တွင် မရှိပါ',
  };
  static final _patterns = <(RegExp, String Function(Match))>[
    (RegExp(r'^(.+) (\d+): only (\d+) unit\(s\) left$'), (m) => '${m[1]} ${m[2]} — ယူနစ် ${m[3]} သာ ကျန်ပါသည်'),
    (RegExp(r'^(.+) (\d+): your limit is (\d+) unit\(s\), (\d+) left$'),
        (m) => '${m[1]} ${m[2]} — သင့်ကန့်သတ်ချက် ${m[3]} ယူနစ်၊ ${m[4]} သာ ကျန်ပါသည်'),
    (RegExp(r'^(.+) (\d+) is a hot number: at most (\d+)% of your total bets \((\d+) Ks\)$'),
        (m) => '${m[1]} ${m[2]} သည် ဟော့ဂဏန်း — စုစုပေါင်းထိုးကြေး၏ ${m[3]}% (${m[4]} Ks) အထိသာ ထိုးနိုင်သည်'),
  ];
  static String translate(String msg) {
    final known = _messages[msg];
    if (known != null) return known;
    for (final (re, fmt) in _patterns) {
      final m = re.firstMatch(msg);
      if (m != null) return fmt(m);
    }
    return msg;
  }

  Future<dynamic> request(String method, String path, {Object? body}) async {
    final uri = Uri.parse('$_server/api$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
    http.Response res;
    try {
      final req = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      // 60s so a Render free-tier cold start (server was asleep, ~50s to wake) still succeeds.
      res = await http.Response.fromStream(await req.send().timeout(const Duration(seconds: 60)));
    } on TimeoutException {
      throw ApiException('Online server နှင့် ချိတ်ဆက်ချိန် ကုန်သွားပါသည်');
    } catch (_) {
      throw ApiException('Online server နှင့် ချိတ်ဆက်၍ မရပါ');
    }

    dynamic data;
    try {
      data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      if (res.statusCode == 401 && path != '/auth/login') onUnauthorized?.call();
      final err = data is Map ? data['error'] as String? : null;
      final issues = data is Map && data['issues'] is List
          ? (data['issues'] as List).map((i) => i is Map ? i['message'] : '$i').join('; ')
          : null;
      final message = translate(err ?? 'Request failed (${res.statusCode})');
      throw ApiException(issues != null && issues.isNotEmpty ? '$message — $issues' : message, res.statusCode);
    }
    return data;
  }

  Future<dynamic> get(String path) => request('GET', path);
  Future<dynamic> post(String path, [Object? body]) => request('POST', path, body: body ?? const {});
  Future<dynamic> put(String path, Object body) => request('PUT', path, body: body);
  Future<dynamic> patch(String path, Object body) => request('PATCH', path, body: body);
  Future<dynamic> delete(String path) => request('DELETE', path);

  // Binary GET (Excel backup). Same auth as request(); non-JSON bodies are returned as bytes.
  Future<({List<int> bytes, String filename})> getFile(String path) async {
    final uri = Uri.parse('$_server/api$path');
    http.Response res;
    try {
      res = await http.get(uri, headers: { if (_token != null) 'Authorization': 'Bearer $_token' }).timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw ApiException('Online server နှင့် ချိတ်ဆက်ချိန် ကုန်သွားပါသည်');
    } catch (_) {
      throw ApiException('Online server နှင့် ချိတ်ဆက်၍ မရပါ');
    }
    if (res.statusCode >= 400) {
      if (res.statusCode == 401) onUnauthorized?.call();
      dynamic data;
      try {
        data = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
      } catch (_) {
        data = null;
      }
      final err = data is Map ? data['error'] as String? : null;
      throw ApiException(translate(err ?? 'Request failed (${res.statusCode})'), res.statusCode);
    }
    final cd = res.headers['content-disposition'] ?? '';
    final name = RegExp(r'filename="([^"]+)"').firstMatch(cd)?.group(1) ?? 'backup.xlsx';
    return (bytes: res.bodyBytes, filename: name);
  }
}

// Small readers for JSON rows (numbers arrive as int or double).
int asInt(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
String? asStr(Object? v) => v?.toString();
