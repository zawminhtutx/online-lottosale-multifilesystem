import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';

// ပြင်/ဖျက် စာရင်း — every change the admin (or agent) made to this user's slips, newest first:
// a slip's lines lowered or removed (ပြင်), or the whole slip cancelled (ဖျက်), with the money
// refunded into the wallet. Opened from the စလစ်များ screen's app bar.
class SlipEditLogScreen extends StatefulWidget {
  const SlipEditLogScreen({super.key});

  @override
  State<SlipEditLogScreen> createState() => _SlipEditLogScreenState();
}

class _SlipEditLogScreenState extends State<SlipEditLogScreen> {
  List<Map<String, dynamic>> logs = [];
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
      final rows = await Api.instance.get('/tickets/edit-logs') as List;
      logs = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return DashScaffold(
      title: const Text('ပြင်/ဖျက် စာရင်း', style: TextStyle(fontWeight: FontWeight.w700)),
      body: loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : RefreshIndicator(
              onRefresh: _load,
              child: error != null
                  ? ListView(children: [
                      Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))),
                    ])
                  : logs.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 120),
                          Center(child: Text('ပြင်ဆင်/ဖျက်ထားသော စလစ် မရှိပါ', style: TextStyle(color: Colors.white70))),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                          itemCount: logs.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (ctx, i) => _LogCard(log: logs[i]),
                        ),
            ),
    );
  }
}

class _LogCard extends StatelessWidget {
  final Map<String, dynamic> log;
  const _LogCard({required this.log});

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final cancelled = log['action'] == 'cancel';
    final lines = (log['lines'] as List? ?? const []).cast<Map>();
    const white = TextStyle(color: Colors.white);
    const dim = TextStyle(color: Colors.white70, fontSize: 12);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: Dash.glassBox(radius: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('${log['slip_no']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(width: 8),
          DecoratedBox(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
            child: cancelled ? const StatusChip('ဖျက်', Color(0xFFDC2626)) : const StatusChip('ပြင်', Color(0xFFD97706)),
          ),
          const Spacer(),
          Text('+${session.money(asInt(log['refund']))}', style: const TextStyle(color: Dash.green, fontWeight: FontWeight.w800)),
        ]),
        const SizedBox(height: 2),
        Text('${log['term_description'] ?? '-'}  ·  ${dateTime(log['created_at'])}', style: dim),
        if (lines.isNotEmpty) ...[
          const SizedBox(height: 6),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(children: [
                SizedBox(width: 56, child: Text('${l['number']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
                Expanded(
                  child: Text(
                    asInt(l['after']) == 0
                        ? '${l['before']} ယူနစ် → ဖျက်'
                        : '${l['before']} ယူနစ် → ${l['after']} ယူနစ်',
                    style: white,
                  ),
                ),
              ]),
            ),
        ],
        const SizedBox(height: 4),
        Text(
          cancelled
              ? 'စလစ် ${session.money(asInt(log['net_before']))} ကျပ် ဖျက်ပြီး ပြန်အမ်းပြီး'
              : '${session.money(asInt(log['net_before']))} → ${session.money(asInt(log['net_after']))} ကျပ်  ·  ${session.money(asInt(log['refund']))} ကျပ် ပြန်အမ်းပြီး',
          style: dim,
        ),
      ]),
    );
  }
}
