import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// ငွေသွင်း/ထုတ် တောင်းဆိုမှု — deposit / withdraw requests from the accounts below (users' phones,
// agents, masters). Approve moves the money out of / back into the deciding master's or agent's own
// balance; Reject keeps balances as they are. Live over WebSocket. A master or an agent can also ask
// the account above it for money (ငွေလက်ခံ upward) and cancel its own request while it waits.
// The admin decides its own masters' requests only; an agent's or a user's request belongs to the
// master / agent above it, so the admin sees those as history with no buttons (the server refuses
// them too).
class WalletRequestsScreen extends StatefulWidget {
  const WalletRequestsScreen({super.key});

  @override
  State<WalletRequestsScreen> createState() => _WalletRequestsScreenState();
}

const _status = <String, (String, Color)>{
  'pending': ('စောင့်ဆိုင်းဆဲ', Color(0xFFD97706)),
  'approved': ('အတည်ပြုပြီး', Color(0xFF059669)),
  'rejected': ('ငြင်းပယ်ပြီး', Color(0xFFDC2626)),
  'cancelled': ('ပယ်ဖျက်ပြီး', Color(0xFF64748B)),
};

class _WalletRequestsScreenState extends State<WalletRequestsScreen> {
  bool pendingOnly = true;
  List<Map<String, dynamic>>? rows;
  String? error;
  final _busy = <int>{};
  void Function()? _stopLive;

  @override
  void initState() {
    super.initState();
    _load();
    _stopLive = Live.instance.listen('wallet-requests', (_) => _load());
  }

  @override
  void dispose() {
    _stopLive?.call();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await Api.instance.get('/wallet-requests${pendingOnly ? '?status=pending' : ''}') as List;
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
    final deposit = r['type'] == 'deposit';
    final ok = await confirm(
      context,
      deposit ? '${r['username']} ထံ ${money(asInt(r['amount']))} ကျပ် ငွေဖြည့်မလား?' : '${r['username']} ထံမှ ${money(asInt(r['amount']))} ကျပ် ငွေထုတ်မလား?',
      message: [r['method'], r['account_name'], r['account_no'], if (r['txn_ref'] != null) 'No. ${r['txn_ref']}'].whereType<Object>().join(' · '),
      ok: 'အတည်ပြုမည်',
    );
    if (!ok) return;
    setState(() => _busy.add(asInt(r['id'])));
    try {
      await Api.instance.post('/wallet-requests/${r['id']}/approve');
      if (mounted) snack(context, 'အတည်ပြုပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _busy.remove(asInt(r['id'])));
    }
  }

  Future<void> _cancelOwn(Map<String, dynamic> r) async {
    if (!await confirm(context, 'တောင်းဆိုမှု ပယ်ဖျက်မလား?', ok: 'ပယ်ဖျက်မည်', danger: true)) return;
    try {
      await Api.instance.post('/wallet-requests/${r['id']}/cancel');
      if (mounted) snack(context, 'ပယ်ဖျက်ပြီးပါပြီ', color: Colors.orange);
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  // A master or an agent asks the account above it: deposit (with where to send the money) or withdraw.
  Future<void> _askUpline() async {
    Map? payTo;
    try {
      payTo = await Api.instance.get('/wallet-requests/pay-to') as Map?;
    } catch (_) {}
    if (!mounted) return;
    final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _AskUplineScreen(payTo: payTo)));
    if (sent == true) _load();
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
    if (go != true) return;
    try {
      await Api.instance.post('/wallet-requests/${r['id']}/reject', {if (ctrl.text.trim().isNotEmpty) 'reason': ctrl.text.trim()});
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
      appBar: AppBar(title: const Text('ငွေသွင်း/ထုတ် တောင်းဆိုမှု')),
      floatingActionButton: session.isDownline
          ? FloatingActionButton.extended(
              onPressed: _askUpline,
              icon: const Icon(Icons.call_made),
              label: Text(session.isMaster ? 'Admin ထံ တောင်းမည်' : 'အထက်အကောင့်ထံ တောင်းမည်'))
          : null,
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
                      ? EmptyView(pendingOnly ? 'စောင့်ဆိုင်းဆဲ တောင်းဆိုမှု မရှိပါ' : 'တောင်းဆိုမှု မရှိသေးပါ')
                      // Phones: one column; tablets / landscape: 2-3 columns of request cards.
                      : AdaptiveListView(
                          padding: const EdgeInsets.fromLTRB(10, 0, 10, 20),
                          spacing: 0,
                          itemCount: rows!.length,
                          itemBuilder: (ctx, i) {
                            final r = rows![i];
                            final deposit = r['type'] == 'deposit';
                            final color = deposit ? const Color(0xFF059669) : const Color(0xFFEA580C);
                            final (label, sColor) = _status[r['status']] ?? ('${r['status']}', Colors.grey);
                            final busy = _busy.contains(asInt(r['id']));
                            final own = asInt(r['user_id']) == session.id; // its own request upward
                            // The admin decides a master's own request only; deeper down it is the
                            // master's / agent's job and the admin just reads it.
                            final canDecide = !session.isAdmin || r['user_role'] == 'master';
                            return SectionCard(children: [
                              Row(children: [
                                Icon(deposit ? Icons.add_circle : Icons.remove_circle, color: color),
                                const SizedBox(width: 6),
                                Text(deposit ? 'ငွေဖြည့်' : 'ငွေထုတ်', style: TextStyle(fontWeight: FontWeight.w900, color: color)),
                                const SizedBox(width: 8),
                                StatusChip(label, sColor),
                                const Spacer(),
                                Text('${session.money(asInt(r['amount']))} Ks', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                              ]),
                              const SizedBox(height: 6),
                              Text('${r['username']} (${r['user_name']}) · လက်ကျန် ${session.money(asInt(r['user_balance']))}',
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                              const SizedBox(height: 2),
                              Wrap(spacing: 10, children: [
                                Text('${r['method']}'),
                                if (r['account_name'] != null) Text('${r['account_name']}'),
                                if (r['account_no'] != null)
                                  InkWell(
                                    onTap: () {
                                      Clipboard.setData(ClipboardData(text: '${r['account_no']}'));
                                      snack(context, 'Copy ကူးပြီး: ${r['account_no']}');
                                    },
                                    child: Text('📋 ${r['account_no']}', style: const TextStyle(color: brand, fontWeight: FontWeight.w700)),
                                  ),
                                if (r['txn_ref'] != null) Text('No. ${r['txn_ref']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              ]),
                              if (r['note'] != null) Text('မှတ်ချက်: ${r['note']}', style: TextStyle(color: Colors.grey[700])),
                              Text(dateTime(r['created_at']), style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                              if (r['reject_reason'] != null) Text('အကြောင်းပြချက်: ${r['reject_reason']}', style: const TextStyle(color: Color(0xFFDC2626))),
                              if (r['decided_by_username'] != null)
                                Text('${r['decided_by_username']} · ${dateTime(r['decided_at'])}', style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                              if (r['status'] == 'pending' && own) ...[
                                const SizedBox(height: 8),
                                OutlinedButton(
                                  style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                                  onPressed: () => _cancelOwn(r),
                                  child: const Text('ကိုယ်ပိုင် တောင်းဆိုမှု — ပယ်ဖျက်မည်'),
                                ),
                              ],
                              if (r['status'] == 'pending' && !own && !canDecide)
                                Text('အတည်ပြုခြင်း / ငြင်းပယ်ခြင်းကို သက်ဆိုင်ရာ Master / Agent က လုပ်ပါမည်',
                                    style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                              if (r['status'] == 'pending' && !own && canDecide) ...[
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

const _methods = ['KPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Cash', 'Other'];

// The master's / agent's own request upward. payTo: that account's KPay / WavePay numbers (or null).
class _AskUplineScreen extends StatefulWidget {
  final Map? payTo;
  const _AskUplineScreen({this.payTo});

  @override
  State<_AskUplineScreen> createState() => _AskUplineScreenState();
}

class _AskUplineScreenState extends State<_AskUplineScreen> {
  String type = 'deposit';
  String method = 'KPay';
  final _amount = TextEditingController();
  final _ref = TextEditingController();
  final _accName = TextEditingController();
  final _accNo = TextEditingController();
  final _note = TextEditingController();
  bool busy = false;
  String? error;

  Future<void> _send() async {
    final amount = int.tryParse(_amount.text) ?? 0;
    if (amount <= 0) return setState(() => error = 'ပမာဏ ထည့်ပါ');
    String? opt(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await Api.instance.post('/wallet-requests', {
        'type': type,
        'amount': amount,
        'method': method,
        if (opt(_ref) != null) 'txn_ref': opt(_ref),
        if (opt(_accName) != null) 'account_name': opt(_accName),
        if (opt(_accNo) != null) 'account_no': opt(_accNo),
        if (opt(_note) != null) 'note': opt(_note),
      });
      if (mounted) {
        snack(context, 'တောင်းဆိုပြီးပါပြီ');
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String l) => InputDecoration(labelText: l, border: const OutlineInputBorder(), isDense: true);
    const gap = SizedBox(height: 12);
    final p = widget.payTo;
    final deposit = type == 'deposit';
    return Scaffold(
      appBar: AppBar(title: Text(context.read<Session>().isMaster ? 'Admin ထံ တောင်းမည်' : 'အထက်အကောင့်ထံ တောင်းမည်')),
      body: ContentWidth(
        maxWidth: 640,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          if (error != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(10)),
              child: Text(error!, style: const TextStyle(color: Colors.red)),
            ),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'deposit', label: Text('ငွေဖြည့်')), ButtonSegment(value: 'withdraw', label: Text('ငွေထုတ်'))],
            selected: {type},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => type = s.first),
          ),
          gap,
          if (deposit && p != null)
            Card(
              color: const Color(0xFFEFF6FF),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${p['username']} ထံ ငွေလွှဲရန်', style: const TextStyle(fontWeight: FontWeight.w800)),
                  if (p['kpay_no'] != null) Text('KPay ${p['kpay_no']}${p['kpay_name'] != null ? ' (${p['kpay_name']})' : ''}'),
                  if (p['wave_no'] != null) Text('WavePay ${p['wave_no']}${p['wave_name'] != null ? ' (${p['wave_name']})' : ''}'),
                ]),
              ),
            ),
          if (deposit && p != null) gap,
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            decoration: deco('ပမာဏ (ကျပ်)'),
          ),
          gap,
          DropdownButtonFormField<String>(
            initialValue: method,
            decoration: deco('ငွေလွှဲနည်း'),
            items: [for (final m in _methods) DropdownMenuItem(value: m, child: Text(m))],
            onChanged: (v) => setState(() => method = v ?? method),
          ),
          gap,
          if (deposit) ...[TextField(controller: _ref, decoration: deco('ငွေလွှဲ No. (Transaction)')), gap],
          TextField(controller: _accName, decoration: deco(deposit ? 'ပေးပို့သူ အမည်' : 'လက်ခံမည့် အကောင့်အမည်')),
          gap,
          TextField(controller: _accNo, keyboardType: TextInputType.phone, decoration: deco(deposit ? 'ပေးပို့သူ ဖုန်း/အကောင့်' : 'လက်ခံမည့် ဖုန်း/အကောင့် (မဖြစ်မနေ)')),
          gap,
          TextField(controller: _note, decoration: deco('မှတ်ချက် (မဖြည့်လည်းရ)')),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: busy ? null : _send,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
            icon: const Icon(Icons.send),
            label: const Text('တောင်းဆိုမည်'),
          ),
        ]),
      ),
    );
  }
}
