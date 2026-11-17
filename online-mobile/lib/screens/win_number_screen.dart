import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import '../widgets/responsive_layout.dart';

// ပေါက်ဂဏန်း — winning numbers of drawn/settled terms, like the POS mobile app's win number view
// (circle, term, number on the right; Twod list under a 3D result), plus the user's own winnings.
class WinNumberScreen extends StatefulWidget {
  const WinNumberScreen({super.key});

  @override
  State<WinNumberScreen> createState() => _WinNumberScreenState();
}

class _WinNumberScreenState extends State<WinNumberScreen> {
  List<Map<String, dynamic>> terms = [];
  Map<int, int> winsByTerm = {};
  String game = '';
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final results = await Future.wait([
        Api.instance.get('/terms/results${game.isEmpty ? '' : '?game=$game'}'),
        Api.instance.get('/tickets?status=won&limit=500'),
      ]);
      terms = (results[0] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      winsByTerm = {};
      for (final t in results[1] as List) {
        final m = t as Map;
        final id = asInt(m['term_id']);
        winsByTerm[id] = (winsByTerm[id] ?? 0) + asInt(m['win_amount']);
      }
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    // Dashboard look: indigo gradient, white result cards.
    return DashScaffold(
      title: const Text('🏆 ပေါက်ဂဏန်း', style: TextStyle(fontWeight: FontWeight.w700)),
      actions: [
        GlassIconButton(icon: Icons.refresh, tooltip: 'Refresh', onPressed: _load),
        const SizedBox(width: 16),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
          child: SegmentedButton<String>(
            style: SegmentedButton.styleFrom(
              backgroundColor: Dash.glass,
              foregroundColor: Colors.white,
              selectedBackgroundColor: const Color(0xFFE4E4FB),
              selectedForegroundColor: Dash.ink,
              side: BorderSide(color: Dash.glassBorder),
            ),
            segments: const [
              ButtonSegment(value: '', label: Text('အားလုံး')),
              ButtonSegment(value: '2D', label: Text('2D')),
              ButtonSegment(value: '3D', label: Text('3D')),
            ],
            selected: {game},
            showSelectedIcon: false,
            onSelectionChanged: (s) {
              setState(() => game = s.first);
              _load();
            },
          ),
        ),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator(color: Colors.white))
              : error != null
                  ? Center(
                      child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: terms.isEmpty
                          ? ListView(children: const [
                              SizedBox(height: 120),
                              Center(child: Text('ပေါက်ဂဏန်း မထွက်သေးပါ', style: TextStyle(color: Colors.white70))),
                            ])
                          // Phones: one column; tablets / landscape: 2-3 columns of result cards.
                          : AdaptiveListView(
                              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                              itemCount: terms.length,
                              physics: const AlwaysScrollableScrollPhysics(), // pull to refresh
                              itemBuilder: (ctx, i) {
                                final t = terms[i];
                                final results = (t['results'] as List? ?? const []).cast<Map>();
                                final r3 = results.where((r) => asInt(r['slot']) == 1).map((r) => '${r['value']}').firstOrNull;
                                // 2D terms have only the 2D result; older 2D+3D terms derive it from 3D.
                                final r2 = results.where((r) => asInt(r['slot']) == 2).map((r) => '${r['value']}').firstOrNull ??
                                    (t['game'] == '2D3D' && r3 != null ? r3.substring(1) : null);
                                final number = t['game'] == '3D' ? r3 : r2;
                                final twod = t['game'] == '3D' ? twodNumbers(r3) : const <String>[];
                                final win = winsByTerm[asInt(t['id'])] ?? 0;
                                return Card(
                                  elevation: 0,
                                  margin: EdgeInsets.zero,
                                  color: Colors.white,
                                  surfaceTintColor: Colors.white,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                                  child: ListTile(
                                    leading: GameCircle('${t['game']}'),
                                    title: Text('${t['description']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      if (parseDate(t['draw_at'] ?? t['close_at']) != null)
                                        Text(dateTime(t['draw_at'] ?? t['close_at']), style: const TextStyle(fontSize: 11.5)),
                                      if (twod.isNotEmpty) Text('တွဒ်: ${twod.join(', ')}', style: const TextStyle(fontSize: 12)),
                                      if (win > 0)
                                        Text('🎉 သင့်ဆုငွေ ${session.money(win)} ကျပ်',
                                            style: const TextStyle(color: Color(0xFF059669), fontWeight: FontWeight.w800, fontSize: 12.5)),
                                    ]),
                                    trailing: number == null
                                        ? const Text('မထည့်ရသေးပါ', style: TextStyle(color: Colors.grey))
                                        : Text(number, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 22, letterSpacing: 2, color: Dash.ink)),
                                  ),
                                );
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}
