import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// စလစ်ဖျက်ရန် request — users ask; admin / master / agent (own downline) approve or reject.
class SlipCancelRequestsScreen extends StatefulWidget {
  const SlipCancelRequestsScreen({super.key});

  @override
  State<SlipCancelRequestsScreen> createState() => _SlipCancelRequestsScreenState();
}

const _status = <String, (String, Color)>{
  'pending': ('စောင့်ဆိုင်းဆဲ', Color(0xFFD97706)),
  'approved': ('အတည်ပြုပြီး', Color(0xFF059669)),
  'rejected': ('ငြင်းပယ်ပြီး', Color(0xFFDC2626)),
};

class _SlipCancelRequestsScreenState extends State<SlipCancelRequestsScreen> {
  bool pendingOnly = true;
  List<Map<String, dynamic>>? rows;
  String? error;
  final _busy = <int>{};
  void Function()? _stopLive;

  @override
  void initState() {
    super.initState();
    _load();
    _stopLive = Live.instance.listen('slip-cancel-requests', (_) => _load());
  }

  @override
  void dispose() {
    _stopLive?.call();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await Api.instance.get('/slip-cancel-requests${pendingOnly ? '?status=pending' : ''}') as List;
      if (!mounted) return;
      setState(() {
        rows = data.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _approve(Map<String, dynamic> r) async {
    final money = context.read<Session>().money;
    final ok = await confirm(
      context,
      'စလစ် ${r['slip_no']} ဖျက်မလား?',
      message: '${r['username']}  ·  ${money(asInt(r['net_amount']))} ကျပ် ပြန်အမ်းပါမည်။',
      ok: 'အတည်ပြုမည်',
      danger: true,
    );
    if (!ok) return;
    setState(() => _busy.add(asInt(r['id'])));
    try {
      await Api.instance.post('/slip-cancel-requests/${r['id']}/approve');
      if (mounted) snack(context, 'စလစ် ဖျက်ပြီး ငွေပြန်အမ်းပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _busy.remove(asInt(r['id'])));
    }
  }

  Future<void> _reject(Map<String, dynamic> r) async {
    final ctrl = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('တောင်းဆိုမှု ငြင်းပယ်ရန်'),
        content: TextField(controller: ctrl, decoration: const InputDecoration(labelText: 'အကြောင်းပြချက် (မဖြည့်လည်းရ)', border: OutlineInputBorder())),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.pop(ctx, true), child: const Text('ငြင်းပယ်မည်')),
        ],
      ),
    );
    final reason = ctrl.text.trim();
    ctrl.dispose();
    if (go != true) return;
    try {
      await Api.instance.post('/slip-cancel-requests/${r['id']}/reject', {if (reason.isNotEmpty) 'reason': reason});
      if (mounted) snack(context, 'ငြင်းပယ်ပြီးပါပြီ', color: Colors.orange);
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return Scaffold(
      appBar: AppBar(title: const Text('စလစ်ဖျက်ရန်')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(10),
          child: SegmentedButton<bool>(
            segments: const [ButtonSegment(value: true, label: Text('စောင့်ဆိုင်းဆဲ')), ButtonSegment(value: false, label: Text('အားလုံး'))],
            selected: {pendingOnly},
            showSelectedIcon: false,
            onSelectionChanged: (s) {
              setState(() {
                pendingOnly = s.first;
                rows = null;
              });
              _load();
            },
          ),
        ),
        Expanded(
          child: rows == null
              ? (error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: rows!.isEmpty
                      ? EmptyView(pendingOnly ? 'စောင့်ဆိုင်းဆဲ တောင်းဆိုမှု မရှိပါ' : 'တောင်းဆိုမှု မရှိသေးပါ', icon: Icons.delete_outline)
                      : AdaptiveListView(
                          padding: const EdgeInsets.fromLTRB(10, 0, 10, 20),
                          spacing: 0,
                          itemCount: rows!.length,
                          itemBuilder: (ctx, i) {
                            final r = rows![i];
                            final (label, color) = _status[r['status']] ?? ('${r['status']}', Colors.grey);
                            final busy = _busy.contains(asInt(r['id']));
                            return SectionCard(children: [
                              Row(children: [
                                const Icon(Icons.delete_outline, color: Color(0xFFDC2626)),
                                const SizedBox(width: 6),
                                Text('S${r['term_id']}-${r['slip_no']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                                const SizedBox(width: 8),
                                StatusChip(label, color),
                                const Spacer(),
                                Text('${session.money(asInt(r['net_amount']))} Ks', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                              ]),
                              const SizedBox(height: 6),
                              Text('${r['username']}${r['user_name'] != null && '${r['user_name']}'.isNotEmpty ? '  (${r['user_name']})' : ''}',
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                              Text('${r['term_description'] ?? ''}  ·  ${dateTime(r['created_at'])}',
                                  style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                              if (r['reject_reason'] != null) Text('အကြောင်းပြချက်: ${r['reject_reason']}', style: const TextStyle(color: Color(0xFFDC2626))),
                              if (r['decided_by_username'] != null)
                                Text('${r['decided_by_username']}  ·  ${dateTime(r['decided_at'])}', style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                              if (r['status'] == 'pending') ...[
                                const SizedBox(height: 8),
                                Row(children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                                      onPressed: busy ? null : () => _reject(r),
                                      child: const Text('ငြင်းပယ်မည်'),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: FilledButton(
                                      style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669)),
                                      onPressed: busy ? null : () => _approve(r),
                                      child: busy
                                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                          : const Text('အတည်ပြုမည်'),
                                    ),
                                  ),
                                ]),
                              ],
                            ]);
                          },
                        ),
                ),
        ),
      ]),
    );
  }
}
