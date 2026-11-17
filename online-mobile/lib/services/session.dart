import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

import 'api.dart';
import 'company.dart';

// The app's navigator: signing out closes every open screen so Login shows (see _signedOut).
final navigatorKey = GlobalKey<NavigatorState>();

// Who is signed in (an OnlineLotto "user" account) plus their current balance.
class Session extends ChangeNotifier {
  Map<String, dynamic>? user;
  bool ready = false;

  final _money = NumberFormat('#,##0');
  String money(num? v) => _money.format(v ?? 0);

  int get balance => asInt(user?['balance']);
  bool get unlimited => asInt(user?['unlimited']) == 1;
  String get name => '${user?['name'] ?? user?['username'] ?? ''}';

  Future<void> load() async {
    await Api.instance.load();
    Api.instance.onUnauthorized = () {
      Api.instance.setToken(null);
      _signedOut();
    };
    if (Api.instance.token != null) {
      try {
        user = Map<String, dynamic>.from(await Api.instance.get('/auth/me') as Map);
        await Company.load();
      } catch (e) {
        // Offline at start-up keeps the token (the next screen retries); a rejected token signs out.
        if (e is ApiException && e.status == 401) await Api.instance.setToken(null);
      }
    }
    ready = true;
    notifyListeners();
  }

  // remember: stay signed in after the app closes and fill in the username next time.
  Future<void> login(String username, String password, {bool remember = true}) async {
    final res = await Api.instance.post('/auth/login', {'username': username, 'password': password}) as Map;
    final u = Map<String, dynamic>.from(res['user'] as Map);
    if (u['role'] != 'user') throw ApiException('ဤ App သည် ကစားသူ အကောင့်များအတွက်သာ ဖြစ်သည်');
    await Api.instance.setToken(res['token'] as String, persist: remember);
    await Api.instance.setRememberedUsername(remember ? username : null);
    user = u;
    await Company.load();
    notifyListeners();
  }

  // Balance changes after every slip — refreshed by the screens that change it.
  Future<void> refresh() async {
    try {
      user = Map<String, dynamic>.from(await Api.instance.get('/auth/me') as Map);
      notifyListeners();
    } catch (_) {/* keep the last known values */}
  }

  Future<void> logout() async {
    await Api.instance.setToken(null);
    _signedOut();
  }

  void _signedOut() {
    if (user == null) return;
    user = null;
    navigatorKey.currentState?.popUntil((route) => route.isFirst);
    notifyListeners();
  }
}
