import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';

import 'api.dart';
import 'live.dart';

// The app's navigator: signing out closes every open screen so Login shows.
final navigatorKey = GlobalKey<NavigatorState>();

// Roles that may use this app: the admin (opens master accounts only), masters and agents.
// A master runs its own book — files, terms, breaks, prize sets, agents, users and their money.
// An agent runs only its own users. Each role has its own background colour (RoleLook).
const appRoles = {'admin', 'master', 'agent'};

// The signed-in OnlineLotto admin, master or agent.
class Session extends ChangeNotifier {
  Map<String, dynamic>? user;
  bool ready = false;

  bool get isAdmin => user?['role'] == 'admin';
  bool get isMaster => user?['role'] == 'master';
  bool get isAgent => user?['role'] == 'agent';
  // Files, terms, breaks and prize sets belong to the master. The admin only opens masters.
  bool get isBook => isMaster;
  // A master or an agent: has a wallet of its own. Deposits it makes come out of that balance.
  bool get isDownline => isMaster || isAgent;
  bool get canSaveOver => isAdmin || asInt(user?['sale_over']) == 1;
  String get role => '${user?['role'] ?? ''}';
  String get roleName => isAdmin ? 'Admin' : isMaster ? 'Master' : isAgent ? 'Agent' : '';
  int get id => (user?['id'] as num?)?.toInt() ?? 0;

  final _money = NumberFormat('#,##0');
  String money(num? v) => _money.format(v ?? 0);
  String get name => '${user?['name'] ?? user?['username'] ?? ''}';

  Future<void> load() async {
    await Api.instance.load();
    Api.instance.onUnauthorized = () {
      Api.instance.setToken(null);
      _signedOut();
    };
    if (Api.instance.token != null) {
      try {
        final me = Map<String, dynamic>.from(await Api.instance.get('/auth/me') as Map);
        if (appRoles.contains(me['role'])) {
          user = me;
        } else {
          await Api.instance.setToken(null);
        }
      } catch (e) {
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
    if (!appRoles.contains(u['role'])) throw ApiException('ဤ App သည် Admin / Master / Agent အကောင့်များအတွက်သာ ဖြစ်သည်');
    await Api.instance.setToken(res['token'] as String, persist: remember);
    await Api.instance.setRememberedUsername(remember ? username : null);
    user = u;
    notifyListeners();
  }

  void setUser(Map<String, dynamic> u) {
    user = {...?user, ...u};
    notifyListeners();
  }

  Future<void> refresh() async {
    try {
      final me = Map<String, dynamic>.from(await Api.instance.get('/auth/me') as Map);
      if (appRoles.contains(me['role'])) {
        user = me;
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> logout() async {
    await Api.instance.setToken(null);
    _signedOut();
  }

  void _signedOut() {
    if (user == null) return;
    user = null;
    Live.instance.stop();
    navigatorKey.currentState?.popUntil((route) => route.isFirst);
    notifyListeners();
  }
}
