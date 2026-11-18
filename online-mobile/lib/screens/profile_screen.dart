import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/company.dart';
import '../services/format.dart';
import '../services/printer_service.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import '../widgets/responsive_layout.dart';
import 'printer_settings_screen.dart';

// ကိုယ်ရေးအချက်အလက် — the user's details and balance, ငွေဖြည့် / ငွေထုတ် requests (the agent
// approves them in the agent dashboard), request and wallet history, change password, Bluetooth
// printer and logout.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

const methods = ['KPay', 'WavePay', 'AYA Pay', 'CB Pay', 'Cash', 'Other'];

const _requestStatus = <String, (String, Color)>{
  'pending': ('စောင့်ဆိုင်းဆဲ', Dash.amber),
  'approved': ('အတည်ပြုပြီး', Dash.green),
  'rejected': ('ငြင်းပယ်ခံရ', Dash.red),
  'cancelled': ('ပယ်ဖျက်ပြီး', Color(0xFFCBD5E1)),
};

const _walletType = <String, String>{
  'deposit': 'ငွေသွင်း',
  'withdraw': 'ငွေထုတ်',
  'transfer_in': 'ငွေလွှဲဝင်',
  'transfer_out': 'ငွေလွှဲထွက်',
  'bet': 'ထိုးငွေ',
  'win': 'ဆုငွေ',
  'refund': 'ငွေပြန်အမ်း',
  'commission': 'ကော်မရှင်',
  'adjust': 'ပြင်ဆင်',
};

class _ProfileScreenState extends State<ProfileScreen> {
  List<Map<String, dynamic>> requests = [];
  List<Map<String, dynamic>> wallet = [];
  bool loading = true;
  String? error;
  int tab = 0; // 0 requests, 1 wallet history
  // KPay / WavePay of the account this user is under (agent, master or admin): where deposits go.
  Map<String, dynamic>? payTo;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final results = await Future.wait([Api.instance.get('/wallet-requests?limit=100'), Api.instance.get('/wallet/transactions?limit=100')]);
      requests = (results[0] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      wallet = (results[1] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      try {
        final p = await Api.instance.get('/wallet-requests/pay-to');
        payTo = p is Map ? Map<String, dynamic>.from(p) : null;
      } catch (_) {}
      error = null;
      if (mounted) await context.read<Session>().refresh();
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _request(String type) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => _RequestSheet(type: type),
    );
    if (sent == true) {
      _snack(type == 'deposit' ? 'ငွေဖြည့် တောင်းဆိုပြီးပါပြီ — အတည်ပြုရန် စောင့်ပါ' : 'ငွေထုတ် တောင်းဆိုပြီးပါပြီ — အတည်ပြုရန် စောင့်ပါ', Colors.teal);
      setState(() => tab = 0);
      _load();
    }
  }

  Future<void> _cancel(Map<String, dynamic> r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('တောင်းဆိုမှု ပယ်ဖျက်မလား?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မဟုတ်ပါ')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ပယ်ဖျက်မည်')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/wallet-requests/${r['id']}/cancel');
      _load();
    } catch (e) {
      _snack('$e', Colors.red);
    }
  }


  Future<void> _changePassword() async {
    final done = await showDialog<bool>(context: context, builder: (_) => const _PasswordDialog());
    if (done == true) _snack('စကားဝှက် ပြောင်းပြီးပါပြီ', Colors.teal);
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

  Future<void> _editShopName() async {
    final s = await PrinterSettings.load();
    if (!mounted) return;
    final ctrl = TextEditingController(text: s.header);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ဆိုင်အမည် ပြောင်းရန်'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(
            labelText: 'ဆိုင်အမည်',
            hintText: Company.name.isNotEmpty ? Company.name : 'Online Lotto',
            helperText: 'မဖြည့်လျှင် ${Company.name.isNotEmpty ? Company.name : 'Online Lotto'} ကို သုံးမည်',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မပြောင်းဘူး')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('သိမ်းမည်')),
        ],
      ),
    );
    final newHeader = ctrl.text.trim();
    ctrl.dispose();
    if (ok != true || !mounted) return;
    await PrinterSettings(
      name: s.name, mac: s.mac, paperMm: s.paperMm,
      header: newHeader, footer: s.footer,
      twoColumn: s.twoColumn, padLeft: s.padLeft, padRight: s.padRight,
      textAlign: s.textAlign, printOnSave: s.printOnSave,
    ).save();
    if (mounted) setState(() {});
  }

  void _snack(String message, Color color) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: color));
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final u = session.user ?? const {};
    // Dashboard look: indigo gradient, glass cards, ငွေဖြည့် on the light highlight with dark text,
    // ငွေထုတ် as a dark pill.
    return DashScaffold(
      title: const Text('ကိုယ်ရေးအချက်အလက်', style: TextStyle(fontWeight: FontWeight.w700)),
      actions: [
        GlassIconButton(icon: Icons.refresh, tooltip: 'Refresh', onPressed: _load),
        const SizedBox(width: 16),
      ],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ContentWidth(maxWidth: 720, child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
          // Details + balance
          Container(
            padding: const EdgeInsets.all(16),
            decoration: Dash.glassBox(),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: Colors.white.withValues(alpha: .2),
                  child: Text(session.name.isEmpty ? '?' : session.name.substring(0, 1).toUpperCase(),
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 22)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(session.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 17)),
                    Text('@${u['username'] ?? ''}${(u['phone'] ?? '').toString().isNotEmpty ? '  ·  ${u['phone']}' : ''}',
                        style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
                  ]),
                ),
              ]),
              const SizedBox(height: 14),
              const Text('လက်ကျန်ငွေ', style: TextStyle(color: Colors.white70, fontSize: 12.5)),
              Text('${session.money(session.balance)} ကျပ်',
                  style: TextStyle(color: session.balance < 0 ? Dash.red : Colors.white, fontWeight: FontWeight.w900, fontSize: 26)),
              if (session.unlimited) const Text('∞ အကန့်အသတ်မဲ့', style: TextStyle(color: Colors.white70, fontSize: 12)),
            ]),
          ),
          if (payTo != null) ...[
            const SizedBox(height: 12),
            _payToCard(payTo!),
          ],
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: _pillButton(
                icon: Icons.add_circle,
                label: 'ငွေဖြည့်',
                light: true,
                onTap: () => _request('deposit'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _pillButton(icon: Icons.remove_circle, label: 'ငွေထုတ်', onTap: () => _request('withdraw')),
            ),
          ]),
          const SizedBox(height: 12),
          Container(
            decoration: Dash.glassBox(radius: 18),
            child: Column(children: [
              ListTile(
                leading: const Icon(Icons.lock_outline, color: Colors.white),
                title: const Text('စကားဝှက် ပြောင်းရန်', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                trailing: const Icon(Icons.chevron_right, color: Colors.white70),
                onTap: _changePassword,
              ),
              Divider(height: 1, color: Dash.glassBorder),
              if ((u['master_settings'] as Map?)?['allow_name_edit'] == true) ...[
                Divider(height: 1, color: Dash.glassBorder),
                ListTile(
                  leading: const Icon(Icons.store_outlined, color: Colors.white),
                  title: const Text('ဆိုင်အမည် ပြောင်းရန်', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                  subtitle: Text(Company.name.isNotEmpty ? Company.name : 'Online Lotto', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                  trailing: const Icon(Icons.edit_outlined, color: Colors.white70),
                  onTap: _editShopName,
                ),
              ],
              Divider(height: 1, color: Dash.glassBorder),
              ListTile(
                leading: const Icon(Icons.print_outlined, color: Colors.white),
                title: const Text('Bluetooth Printer', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                trailing: const Icon(Icons.chevron_right, color: Colors.white70),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrinterSettingsScreen())),
              ),
              Divider(height: 1, color: Dash.glassBorder),
              ListTile(
                leading: const Icon(Icons.logout, color: Dash.red),
                title: const Text('ထွက်ရန်', style: TextStyle(fontWeight: FontWeight.w700, color: Dash.red)),
                onTap: _logout,
              ),
            ]),
          ),
          const SizedBox(height: 14),
          SegmentedButton<int>(
            style: SegmentedButton.styleFrom(
              backgroundColor: Dash.glass,
              foregroundColor: Colors.white,
              selectedBackgroundColor: const Color(0xFFE4E4FB),
              selectedForegroundColor: Dash.ink,
              side: BorderSide(color: Dash.glassBorder),
            ),
            segments: const [
              ButtonSegment(value: 0, label: Text('ငွေဖြည့်/ထုတ် တောင်းဆိုမှု')),
              ButtonSegment(value: 1, label: Text('ငွေစာရင်း')),
            ],
            selected: {tab},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => tab = s.first),
          ),
          const SizedBox(height: 10),
          if (loading)
            const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator(color: Colors.white)))
          else if (error != null)
            Padding(padding: const EdgeInsets.all(20), child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)))
          else if (tab == 0)
            ..._requestList(session)
          else
            ..._walletList(session),
        ])),
      ),
    );
  }

  // Wide pill button: [light] = the lavender highlight with navy text, otherwise the dark navy pill.
  Widget _pillButton({required IconData icon, required String label, required VoidCallback onTap, bool light = false}) {
    final fg = light ? Dash.ink : Colors.white;
    final radius = BorderRadius.circular(30);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: radius,
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(gradient: light ? Dash.highlight : null, color: light ? null : Dash.ink, borderRadius: radius),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, color: fg),
              const SizedBox(width: 8),
              Text(label, style: TextStyle(color: fg, fontSize: 16, fontWeight: FontWeight.w800)),
            ]),
          ),
        ),
      ),
    );
  }

  List<Widget> _requestList(Session session) {
    if (requests.isEmpty) return const [Padding(padding: EdgeInsets.all(30), child: Center(child: Text('တောင်းဆိုမှု မရှိသေးပါ', style: TextStyle(color: Colors.white70))))];
    return [
      for (final r in requests)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          decoration: Dash.glassBox(radius: 18),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(r['type'] == 'deposit' ? Icons.add_circle : Icons.remove_circle,
                    color: r['type'] == 'deposit' ? Dash.green : Dash.amber),
                const SizedBox(width: 8),
                Text(r['type'] == 'deposit' ? 'ငွေဖြည့်' : 'ငွေထုတ်', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                const SizedBox(width: 8),
                () {
                  final (label, color) = _requestStatus[r['status']] ?? ('${r['status']}', Colors.grey);
                  return StatusChip(label, color);
                }(),
                const Spacer(),
                Text('${session.money(asInt(r['amount']))} Ks', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16)),
              ]),
              const SizedBox(height: 4),
              Text(
                [r['method'], r['account_no'], if (r['txn_ref'] != null) 'No. ${r['txn_ref']}', dateTime(r['created_at'])].whereType<Object>().join('  ·  '),
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
              if (r['reject_reason'] != null)
                Text('အကြောင်းပြချက်: ${r['reject_reason']}', style: const TextStyle(fontSize: 12, color: Dash.red)),
              if (r['status'] == 'pending')
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    style: TextButton.styleFrom(foregroundColor: Colors.white),
                    onPressed: () => _cancel(r),
                    icon: const Icon(Icons.close, size: 18),
                    label: const Text('ပယ်ဖျက်ရန်'),
                  ),
                ),
            ]),
          ),
        ),
    ];
  }

  // The upline's KPay / WavePay numbers, middle hidden; the copy button copies the whole number.
  Widget _payToCard(Map<String, dynamic> p) {
    Widget row(String label, Object? number, Object? name) {
      if (number == null || '$number'.trim().isEmpty) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(children: [
          SizedBox(width: 74, child: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(maskNumber(number), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 1)),
              if (name != null && '$name'.trim().isNotEmpty) Text('$name', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ]),
          ),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54), visualDensity: VisualDensity.compact),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: '$number'.trim()));
              _snack('$label နံပါတ် Copy ကူးပြီးပါပြီ', Colors.teal);
            },
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('Copy'),
          ),
        ]),
      );
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
      decoration: Dash.glassBox(),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('ငွေလွှဲရန် နံပါတ် · ${p['username'] ?? ''}', style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
        row('KPay', p['kpay_no'], p['kpay_name']),
        row('WavePay', p['wave_no'], p['wave_name']),
      ]),
    );
  }

  List<Widget> _walletList(Session session) {
    if (wallet.isEmpty) return const [Padding(padding: EdgeInsets.all(30), child: Center(child: Text('ငွေစာရင်း မရှိသေးပါ', style: TextStyle(color: Colors.white70))))];
    return [
      for (final w in wallet)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Dash.glassBorder))),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_walletType[w['type']] ?? '${w['type']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                Text([dateTime(w['created_at']), if (w['note'] != null) '${w['note']}'].join('  ·  '),
                    style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
              ]),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('${asInt(w['amount']) > 0 ? '+' : ''}${session.money(asInt(w['amount']))}',
                  style: TextStyle(fontWeight: FontWeight.w800, color: asInt(w['amount']) < 0 ? Dash.red : Dash.green)),
              Text('လက်ကျန် ${session.money(asInt(w['balance_after']))}', style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
            ]),
          ]),
        ),
    ];
  }
}

// ငွေဖြည့် / ငွေထုတ် request form.
class _RequestSheet extends StatefulWidget {
  final String type;
  const _RequestSheet({required this.type});

  @override
  State<_RequestSheet> createState() => _RequestSheetState();
}

class _RequestSheetState extends State<_RequestSheet> {
  final _amount = TextEditingController();
  final _name = TextEditingController();
  final _account = TextEditingController();
  final _ref = TextEditingController();
  final _note = TextEditingController();
  String method = methods.first;
  bool busy = false;
  String? error;
  Map<String, dynamic>? payTo; // KPay / WavePay of the parent: the agent, or the master when the user hangs there

  bool get deposit => widget.type == 'deposit';

  String get uplineLabel {
    final role = '${payTo?['role'] ?? ''}';
    if (role == 'master') return 'Master';
    if (role == 'agent') return 'Agent';
    return 'အပေါ်အကောင့်';
  }

  @override
  void initState() {
    super.initState();
    if (deposit) _loadPayTo();
  }

  Future<void> _loadPayTo() async {
    try {
      final r = await Api.instance.get('/wallet-requests/pay-to');
      if (mounted && r is Map) setState(() => payTo = Map<String, dynamic>.from(r));
    } catch (_) {}
  }

  // One "send money here" row: tap to copy the number and pick that method below.
  Widget _payRow(String label, Object? number, Object? name, String methodValue) {
    if (number == null || '$number'.isEmpty) return const SizedBox.shrink();
    return InkWell(
      onTap: () {
        Clipboard.setData(ClipboardData(text: '$number'));
        setState(() => method = methodValue);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Copy ကူးပြီး: $number')));
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          SizedBox(width: 74, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w800))),
          Expanded(
            child: Text([maskNumber(number), if (name != null && '$name'.isNotEmpty) '($name)'].join(' '),
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          ),
          const Icon(Icons.copy, size: 18, color: Color(0xFF059669)),
        ]),
      ),
    );
  }

  Future<void> _submit() async {
    final amount = int.tryParse(_amount.text.replaceAll(',', '').trim()) ?? 0;
    if (amount <= 0) return setState(() => error = 'ပမာဏ ထည့်ပါ');
    if (!deposit && _account.text.trim().isEmpty) return setState(() => error = 'ငွေလက်ခံမည့် ဖုန်း/အကောင့်နံပါတ် ထည့်ပါ');
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await Api.instance.post('/wallet-requests', {
        'type': widget.type,
        'amount': amount,
        'method': method,
        if (_name.text.trim().isNotEmpty) 'account_name': _name.text.trim(),
        if (_account.text.trim().isNotEmpty) 'account_no': _account.text.trim(),
        if (_ref.text.trim().isNotEmpty) 'txn_ref': _ref.text.trim(),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      final msg = e.toString();
      setState(() => error = msg == 'Enter the account to receive the money' ? 'ငွေလက်ခံမည့် ဖုန်း/အကောင့်နံပါတ် ထည့်ပါ' : msg);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = deposit ? const Color(0xFF059669) : const Color(0xFFEA580C);
    InputDecoration deco(String label, {String? hint}) => InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder(), isDense: true);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Icon(deposit ? Icons.add_circle : Icons.remove_circle, color: color),
            const SizedBox(width: 8),
            Text(deposit ? 'ငွေဖြည့် တောင်းဆိုရန်' : 'ငွေထုတ် တောင်းဆိုရန်', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: color)),
            const Spacer(),
            IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
          ]),
          Text(
            deposit
                ? '$uplineLabel ထံ ငွေလွှဲပြီးမှ ငွေလွှဲအမှတ်နှင့်တကွ တောင်းဆိုပါ။ $uplineLabel အတည်ပြုလျှင် လက်ကျန်ငွေ တိုးပါမည်။'
                : '$uplineLabel အတည်ပြုလျှင် လက်ကျန်ငွေမှ နုတ်ပြီး ပေးထားသော အကောင့်သို့ ငွေလွှဲပေးပါမည်။',
            style: TextStyle(color: Colors.grey[700], fontSize: 12.5),
          ),
          if (deposit && payTo != null)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              decoration: BoxDecoration(color: const Color(0xFFECFDF5), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFA7F3D0))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('ဤနံပါတ်သို့ ငွေလွှဲပါ · ${payTo!['username'] ?? uplineLabel}', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
                _payRow('KPay', payTo!['kpay_no'], payTo!['kpay_name'], 'KPay'),
                _payRow('WavePay', payTo!['wave_no'], payTo!['wave_name'], 'WavePay'),
              ]),
            ),
          const SizedBox(height: 14),
          if (error != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(10)),
              child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
            ),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            decoration: deco('ပမာဏ (ကျပ်)'),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: method,
            decoration: deco('ငွေလွှဲနည်း'),
            items: [for (final m in methods) DropdownMenuItem(value: m, child: Text(m))],
            onChanged: (v) => setState(() => method = v ?? method),
          ),
          const SizedBox(height: 10),
          TextField(controller: _name, decoration: deco(deposit ? 'ငွေလွှဲသူ အမည်' : 'ငွေလက်ခံမည့်သူ အမည်')),
          const SizedBox(height: 10),
          TextField(
            controller: _account,
            keyboardType: TextInputType.phone,
            decoration: deco(deposit ? 'ငွေလွှဲသည့် ဖုန်း/အကောင့်' : 'ငွေလက်ခံမည့် ဖုန်း/အကောင့် *'),
          ),
          if (deposit) ...[
            const SizedBox(height: 10),
            TextField(controller: _ref, decoration: deco('ငွေလွှဲ အမှတ် (Transaction No.)')),
          ],
          const SizedBox(height: 10),
          TextField(controller: _note, decoration: deco('မှတ်ချက် (မဖြည့်လည်းရ)')),
          const SizedBox(height: 16),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: color, padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: busy ? null : _submit,
            child: busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('တောင်းဆိုမည်', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          ),
        ]),
      ),
    );
  }
}

class _PasswordDialog extends StatefulWidget {
  const _PasswordDialog();

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _repeat = TextEditingController();
  bool busy = false;
  String? error;

  Future<void> _save() async {
    if (_next.text.length < 6) return setState(() => error = 'စကားဝှက်အသစ်သည် အနည်းဆုံး ၆ လုံး ဖြစ်ရမည်');
    if (_next.text != _repeat.text) return setState(() => error = 'စကားဝှက်အသစ် နှစ်ခု မတူပါ');
    if (_next.text == _current.text) return setState(() => error = 'စကားဝှက်အသစ်သည် လက်ရှိ စကားဝှက်နှင့် မတူရပါ');
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await Api.instance.post('/auth/change-password', {'current_password': _current.text, 'new_password': _next.text});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    TextField pw(TextEditingController c, String label) => TextField(
          controller: c,
          obscureText: true,
          keyboardType: TextInputType.visiblePassword,
          enableSuggestions: false,
          autocorrect: false,
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
        );
    return AlertDialog(
      title: const Text('စကားဝှက် ပြောင်းရန်'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13))),
          pw(_current, 'လက်ရှိ စကားဝှက်'),
          const SizedBox(height: 10),
          pw(_next, 'စကားဝှက်အသစ်'),
          const SizedBox(height: 10),
          pw(_repeat, 'စကားဝှက်အသစ် ထပ်ရိုက်ပါ'),
        ]),
      ),
      actions: [
        TextButton(onPressed: busy ? null : () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(onPressed: busy ? null : _save, child: const Text('ပြောင်းမည်')),
      ],
    );
  }
}
