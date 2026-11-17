import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// Client for the OnlineLotto API (the same Express server the online web app and the admin/agent
// dashboards use). Online users sign in with their OnlineLotto account (role "user") and every
// call carries its JWT. The server address defaults to --dart-define=API_URL=... at build time and
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
    'A delete request for this slip is already waiting': 'ဤစလစ်အတွက် ဖျက်ရန် request ပို့ထားပြီး — admin approve ကို စောင့်ပါ',
    'Term already has results': 'ပေါက်ဂဏန်း ထွက်ပြီး၍ ဖျက်မရပါ',
  };
  static final _patterns = <(RegExp, String Function(Match))>[
    (RegExp(r'^(.+) (\d+): only (\d+) unit\(s\) left$'), (m) => '${m[1]} ${m[2]} — ယူနစ် ${m[3]} သာ ကျန်ပါသည်'),
    (RegExp(r'^(.+) (\d+): your limit is (\d+) unit\(s\), (\d+) left$'),
        (m) => '${m[1]} ${m[2]} — သင့်ကန့်သတ်ချက် ${m[3]} ယူနစ်၊ ${m[4]} သာ ကျန်ပါသည်'),
    (RegExp(r'^(.+) (\d+) is a hot number: at most (\d+)% of your total bets \((\d+) Ks\)$'),
        (m) => '${m[1]} ${m[2]} သည် ဟော့ဂဏန်း — သင့်စုစုပေါင်းထိုးကြေး၏ ${m[3]}% (${m[4]} Ks) အထိသာ ထိုးနိုင်သည်'),
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
}

// Small readers for JSON rows (numbers arrive as int or double).
int asInt(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
String? asStr(Object? v) => v?.toString();
