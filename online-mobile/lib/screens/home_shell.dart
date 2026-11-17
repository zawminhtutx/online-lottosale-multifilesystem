import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/responsive.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import 'active_terms_screen.dart';
import 'profile_screen.dart';
import 'report_screen.dart';
import 'slips_screen.dart';
import 'win_number_screen.dart';

class _MenuItem {
  final String label;
  final IconData icon;
  final Color color;
  final WidgetBuilder builder;
  const _MenuItem(this.label, this.icon, this.color, this.builder);
}

// Dashboard after login — the POS mobile app's tile grid, with the user's balance on top.
// "အရောင်း" opens the open-term picker first, then the Sale screen for that term.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  static final _items = <_MenuItem>[
    _MenuItem('အရောင်း', Icons.casino, const Color(0xFF7C3AED), (_) => const ActiveTermsScreen()),
    _MenuItem('စလစ်', Icons.receipt_long, const Color(0xFF10B981), (_) => const SlipsScreen()),
    _MenuItem('စာရင်းများကြည့်', Icons.percent, const Color(0xFFEF4444), (_) => const ReportScreen()),
    _MenuItem('ပေါက်ဂဏန်း', Icons.emoji_events, const Color(0xFFA855F7), (_) => const WinNumberScreen()),
  ];
  // No menu button any more: tapping the balance card opens the profile (deposit / withdraw
  // requests, wallet history, password, Bluetooth printer).
  static final _profile = _MenuItem('ကိုယ်ရေးအချက်အလက်', Icons.person, const Color(0xFF0EA5E9), (_) => const ProfileScreen());

  @override
  void initState() {
    super.initState();
    context.read<Session>().refresh();
  }

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ထွက်မှာလား?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ထွက်ရန်')),
        ],
      ),
    );
    if (ok == true && mounted) await context.read<Session>().logout();
  }

  Future<void> _open(_MenuItem item) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: item.builder));
    if (mounted) context.read<Session>().refresh(); // balance may have changed
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    // Indigo gradient dashboard: every menu item is the same glass tile.
    return DashScaffold(
      actions: [
        GlassIconButton(icon: Icons.refresh, tooltip: 'Refresh', onPressed: session.refresh),
        const SizedBox(width: 8),
        GlassIconButton(icon: Icons.logout, tooltip: 'ထွက်ရန်', onPressed: _logout),
        const SizedBox(width: 16),
      ],
      body: RefreshIndicator(
        onRefresh: session.refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
          children: [
            const Text('Lotto', style: TextStyle(color: Color(0xFFE0E7FF), fontWeight: FontWeight.w700, fontSize: 30)),
            const SizedBox(height: 2),
            Text('အပါတ်စဥ်ရွေးပြီး ရောင်းပါ', style: TextStyle(color: Colors.white.withValues(alpha: .85), fontSize: 14)),
            const SizedBox(height: 18),
            GestureDetector(onTap: () => _open(_profile), child: _BalanceCard(session: session)),
            const SizedBox(height: 14),
            LayoutBuilder(builder: (ctx, constraints) {
              final crossAxisCount = Responsive.columnsForWidth(constraints.maxWidth, idealCellWidth: 170, minCount: 2, maxCount: 5);
              return GridView.count(
                crossAxisCount: crossAxisCount,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 0.92,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  for (final m in _items) _MenuTile(item: m, onTap: () => _open(m)),
                ],
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  final Session session;
  const _BalanceCard({required this.session});

  @override
  Widget build(BuildContext context) {
    final negative = session.balance < 0;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Dash.glass,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Dash.glassBorder, width: 1.2),
      ),
      child: Row(children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: Colors.white.withValues(alpha: .2),
          child: Text(session.name.isEmpty ? '?' : session.name.substring(0, 1).toUpperCase(),
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(session.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
            Text('@${session.user?['username'] ?? ''}', style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
          ]),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(30)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            const Text('လက်ကျန်ငွေ', style: TextStyle(color: Colors.white70, fontSize: 11.5)),
            Text('${session.money(session.balance)} ကျပ်',
                style: TextStyle(color: negative ? Colors.red.shade100 : Colors.white, fontWeight: FontWeight.w900, fontSize: 18)),
            if (session.unlimited) const Text('∞ အကန့်အသတ်မဲ့', style: TextStyle(color: Colors.white70, fontSize: 11)),
          ]),
        ),
      ]),
    );
  }
}

class _MenuTile extends StatelessWidget {
  final _MenuItem item;
  final VoidCallback onTap;
  const _MenuTile({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(22);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: radius,
        onTap: onTap,
        child: Ink(
          decoration: Dash.glassBox(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(item.icon, color: Colors.white, size: 40),
                const SizedBox(height: 10),
                Text(item.label,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), shape: BoxShape.circle),
                  child: const Icon(Icons.arrow_forward, color: Colors.white, size: 18),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
