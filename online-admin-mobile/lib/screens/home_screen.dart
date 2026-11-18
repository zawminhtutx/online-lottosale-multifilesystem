import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/live.dart';
import '../services/responsive.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import 'accounts_screen.dart';
import 'commissions_screen.dart';
import 'prize_assign_screen.dart';
import 'prize_rates_screen.dart';
import 'profile_screen.dart';
import 'report_screen.dart';
import 'slip_cancel_requests_screen.dart';
import 'slips_screen.dart';
import 'terms_screen.dart';
import 'wallet_requests_screen.dart';
import 'wallet_transfer_screen.dart';
import 'active_terms_screen.dart';

class _Tile {
  final String label;
  final IconData icon;
  final Color color;
  final WidgetBuilder builder;
  final bool requests;
  final bool slipDeletes;
  const _Tile(this.label, this.icon, this.color, this.builder, {this.requests = false, this.slipDeletes = false});
}

// Admin opens master accounts and nothing else. A master runs its own book and its own agents and
// users. An agent sees only its own users.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static List<_Tile> _tilesFor(Session session) => [
    if (session.isAdmin)
      _allTiles.firstWhere((t) => t.label == 'Masters')
    else
      for (final t in _allTiles)
        if (t.label != 'Masters' &&
            t.label != 'Admins' &&
            (!_bookTiles.contains(t.label) || session.isBook) &&
            !(session.isAgent && _notForAgent.contains(t.label)))
          t,
  ];
  // Prize rates belong to the master's own book.
  static const _bookTiles = {'အလျော်အဆ'};
  // An agent has no agents under it; ကော်မရှင် stays — it sets its own users'.
  static const _notForAgent = {'Agents'};
  static final _allTiles = <_Tile>[
    _Tile('အရောင်း', Icons.point_of_sale, const Color(0xFF7C3AED), (_) => const ActiveTermsScreen()),
    _Tile('စလစ်များ', Icons.receipt_long, const Color(0xFF10B981), (_) => const SlipsScreen()),
    _Tile('အပါတ်စဥ်', Icons.event_note, const Color(0xFF4338CA), (_) => const TermsScreen()),
    _Tile('စာရင်းများ', Icons.bar_chart, const Color(0xFFEF4444), (_) => const ReportScreen()),
    _Tile('ငွေသွင်း/ထုတ်\nတောင်းဆိုမှု', Icons.swap_vert_circle, const Color(0xFF059669), (_) => const WalletRequestsScreen(), requests: true),
    _Tile('ငွေ Transfer', Icons.swap_horiz, const Color(0xFF0D9488), (_) => const WalletTransferScreen()),
    _Tile('Agents', Icons.support_agent, const Color(0xFFEA580C), (_) => const AccountsScreen(role: 'agent')),
    _Tile('Users', Icons.groups, const Color(0xFF0EA5E9), (_) => const AccountsScreen(role: 'user')),
    _Tile('ကော်မရှင်', Icons.percent, const Color(0xFFD97706), (_) => const CommissionsScreen()),
    _Tile('စလစ်ဖျက်ရန်\n(Request Delete)', Icons.delete_sweep, const Color(0xFFDC2626), (_) => const SlipCancelRequestsScreen(), slipDeletes: true),
    _Tile('အလျော်အဆ', Icons.emoji_events, const Color(0xFFCA8A04), (_) => const PrizeRatesScreen()),
    _Tile('အလျော်အဆတွဲ', Icons.link, const Color(0xFF7C3AED), (_) => const PrizeAssignScreen()),
    _Tile('Masters', Icons.workspace_premium, const Color(0xFFBE185D), (_) => const AccountsScreen(role: 'master')),
    _Tile('Admins', Icons.admin_panel_settings, const Color(0xFF7C3AED), (_) => const AccountsScreen(role: 'admin')),
  ];

  Map<String, dynamic>? overview;
  int pending = 0;
  int slipPending = 0;
  String? error;
  final _stops = <void Function()>[];

  @override
  void initState() {
    super.initState();
    _load();
    _stops.add(Live.instance.listen('wallet-requests', (_) => _loadPending()));
    _stops.add(Live.instance.listen('slip-cancel-requests', (_) => _loadPending()));
  }

  @override
  void dispose() {
    for (final s in _stops) {
      s();
    }
    super.dispose();
  }

  Future<void> _loadPending() async {
    try {
      final r = await Api.instance.get('/wallet-requests/pending-count') as Map;
      if (mounted) setState(() => pending = asInt(r['count']));
    } catch (_) {}
    try {
      final r = await Api.instance.get('/slip-cancel-requests/pending-count') as Map;
      if (mounted) setState(() => slipPending = asInt(r['count']));
    } catch (_) {}
  }

  Future<void> _load() async {
    try {
      final o = Map<String, dynamic>.from(await Api.instance.get('/reports/overview') as Map);
      if (mounted) setState(() => overview = o);
      error = null;
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
    await _loadPending();
  }

  Future<void> _open(_Tile t) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: t.builder));
    _load();
  }

  Future<void> _logout() async {
    if (await confirm(context, 'ထွက်မှာလား?', ok: 'ထွက်ရန်') && mounted) await context.read<Session>().logout();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final o = overview;
    int count(String role, String key) =>
        asInt(((o?['accounts'] as List?) ?? const []).cast<Map>().where((a) => a['role'] == role).map((a) => a[key]).firstOrNull);
    int terms(String status) =>
        asInt(((o?['terms'] as List?) ?? const []).cast<Map>().where((a) => a['status'] == status).map((a) => a['count']).firstOrNull);
    return Scaffold(
      appBar: AppBar(
        title: Text('Lotto ${session.roleName}'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          IconButton(
            icon: const Icon(Icons.account_circle),
            tooltip: 'Profile',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
          ),
          IconButton(icon: const Icon(Icons.logout), tooltip: 'ထွက်ရန်', onPressed: _logout),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: lookFor(session.role).header),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.admin_panel_settings, color: Colors.white70),
                const SizedBox(width: 8),
                Expanded(child: Text(session.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16))),
                if (error != null) const Icon(Icons.cloud_off, color: Colors.orangeAccent, size: 18),
              ]),
              if (!session.isAdmin) ...[
                const SizedBox(height: 12),
                const Text('ယနေ့ အရောင်း', style: TextStyle(color: Colors.white70, fontSize: 12.5)),
                Text('${session.money(asInt(o?['today']?['sales']))} ကျပ်',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 26)),
                Text('စလစ် ${session.money(asInt(o?['today']?['tickets']))}', style: const TextStyle(color: Colors.white70)),
              ] else ...[
                const SizedBox(height: 8),
                const Text('မာစတာ အကောင့်ဖွင့်ရန်', style: TextStyle(color: Colors.white70, fontSize: 13)),
              ],
            ]),
          ),
          const SizedBox(height: 10),
          Row(children: [
            if (session.isAdmin)
              _Stat('Masters', '${count('master', 'count')}', sub: '${session.money(count('master', 'balance'))} Ks')
            else ...[
              if (!session.isAgent) ...[
                _Stat('Agents', '${count('agent', 'count')}', sub: '${session.money(count('agent', 'balance'))} Ks', small: session.isDownline),
                const SizedBox(width: 8),
              ],
              _Stat('Users', '${count('user', 'count')}', sub: '${session.money(count('user', 'balance'))} Ks', small: session.isDownline),
              const SizedBox(width: 8),
              _Stat('ဖွင့်ထား', '${terms('open')}', sub: 'အပါတ်စဥ်', small: session.isDownline),
            ],
          ]),
          const SizedBox(height: 14),
          LayoutBuilder(builder: (ctx, constraints) {
            final cols = Responsive.columnsForWidth(constraints.maxWidth, idealCellWidth: 170, minCount: 2, maxCount: 5);
            return GridView.count(
              crossAxisCount: cols,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.15,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [for (final t in _tilesFor(session)) _TileCard(tile: t, badge: t.requests ? pending : t.slipDeletes ? slipPending : 0, onTap: () => _open(t))],
            );
          }),
        ]),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final bool small; // a master / agent dashboard: the count cards sit in one row
  const _Stat(this.label, this.value, {this.sub, this.small = false});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: EdgeInsets.all(small ? 7 : 10),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.grey.shade200)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(color: Colors.grey[600], fontSize: small ? 11 : 12)),
            Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: small ? 15 : 20)),
            if (sub != null) FittedBox(child: Text(sub!, style: TextStyle(color: Colors.grey[600], fontSize: small ? 10.5 : 11.5))),
          ]),
        ),
      );
}

class _TileCard extends StatelessWidget {
  final _Tile tile;
  final int badge;
  final VoidCallback onTap;
  const _TileCard({required this.tile, required this.badge, required this.onTap});

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.grey.shade200)),
            child: Stack(children: [
              Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    padding: const EdgeInsets.all(13),
                    decoration: BoxDecoration(color: tile.color.withValues(alpha: .12), shape: BoxShape.circle),
                    child: Icon(tile.icon, color: tile.color, size: 28),
                  ),
                  const SizedBox(height: 8),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Text(tile.label, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                  ),
                ]),
              ),
              if (badge > 0)
                Positioned(
                  top: 10,
                  right: 10,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: Colors.red, borderRadius: BorderRadius.circular(20)),
                    child: Text('$badge', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                  ),
                ),
            ]),
          ),
        ),
      );
}
