import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/report_text.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import 'accounts_screen.dart';

// The signed-in admin's own account: details (edited with the account form) and a password
// change that needs the current password.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  // KPay / WavePay: users under this admin see these on the app's ငွေဖြည့် screen.
  final _pay = {for (final k in _payKeys) k: TextEditingController()};
  bool busy = false;
  bool payBusy = false;
  // Company name heading every shared စာရင်း (admin only; see services/report_text.dart).
  final _company = TextEditingController();
  bool companyBusy = false;

  static const _payKeys = ['kpay_no', 'kpay_name', 'wave_no', 'wave_name'];

  @override
  void initState() {
    super.initState();
    final u = context.read<Session>().user ?? const {};
    for (final k in _payKeys) {
      _pay[k]!.text = '${u[k] ?? ''}';
    }
    Api.instance.get('/settings/company').then((r) {
      if (mounted) _company.text = '${(r as Map)['company_name'] ?? ''}';
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    _company.dispose();
    for (final c in _pay.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _edit() async {
    final session = context.read<Session>();
    final saved = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(builder: (_) => AccountFormScreen(role: '${session.user?['role'] ?? 'admin'}', account: session.user)),
    );
    if (saved != null) {
      session.setUser(saved);
      if (mounted) snack(context, 'သိမ်းပြီးပါပြီ');
    }
  }

  Future<void> _savePay() async {
    final session = context.read<Session>();
    setState(() => payBusy = true);
    try {
      final id = session.user?['id'];
      final saved = await Api.instance.patch('/users/$id', {for (final k in _payKeys) k: _pay[k]!.text.trim().isEmpty ? null : _pay[k]!.text.trim()});
      session.setUser(Map<String, dynamic>.from(saved as Map));
      if (mounted) snack(context, 'ငွေလွှဲနံပါတ် သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => payBusy = false);
    }
  }

  Future<void> _saveCompany() async {
    setState(() => companyBusy = true);
    try {
      final r = await Api.instance.put('/settings/company', {'company_name': _company.text.trim()}) as Map;
      Company.set('${r['company_name'] ?? ''}');
      if (mounted) snack(context, 'Company Name သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => companyBusy = false);
    }
  }

  Future<void> _changePassword() async {
    if (_next.text.length < 6) return errorSnack(context, 'စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး ဖြစ်ရပါမည်');
    if (_next.text != _confirm.text) return errorSnack(context, 'စကားဝှက်အသစ် နှစ်ခု မတူပါ');
    setState(() => busy = true);
    try {
      await Api.instance.post('/auth/change-password', {'current_password': _current.text, 'new_password': _next.text});
      _current.clear();
      _next.clear();
      _confirm.clear();
      if (mounted) snack(context, 'စကားဝှက် ပြောင်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final u = session.user ?? const {};
    InputDecoration deco(String l) => InputDecoration(labelText: l, border: const OutlineInputBorder(), isDense: true);
    TextField pw(TextEditingController c, String label) => TextField(
          controller: c,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          keyboardType: TextInputType.visiblePassword,
          decoration: deco(label),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Profile'), actions: [IconButton(icon: const Icon(Icons.edit), tooltip: 'ပြင်ရန်', onPressed: _edit)]),
      body: ContentWidth(maxWidth: 720, child: ListView(padding: const EdgeInsets.all(12), children: [
        SectionCard(children: [
          Row(children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: lookFor(session.role).seed.withValues(alpha: .15),
              backgroundImage: accountLogo(u['logo']),
              child: accountLogo(u['logo']) == null
                  ? Text('${u['username'] ?? '?'}'.substring(0, 1).toUpperCase(), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900))
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${u['name'] ?? ''}${(u['name_mm'] ?? '').toString().isNotEmpty ? ' · ${u['name_mm']}' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                if ((u['master_name'] ?? '').toString().isNotEmpty)
                  Text('${u['master_name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('@${u['username'] ?? ''} · ${session.roleName}', style: TextStyle(color: Colors.grey[700])),
              ]),
            ),
          ]),
          const Divider(height: 22),
          _row('Email', u['email']),
          _row('ဖုန်း', u['phone']),
          _row('လိပ်စာ', u['address']),
          _row('နောက်ဆုံးဝင်ချိန်', u['last_login_at'] == null ? null : dateTime(u['last_login_at'])),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _edit, icon: const Icon(Icons.edit), label: const Text('အချက်အလက် ပြင်ရန်')),
          // A master / an agent has a wallet of its own: its balance and every movement in and out.
          if (session.isDownline) ...[
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AccountDetailScreen(userId: session.id))),
              icon: const Icon(Icons.account_balance_wallet),
              label: const Text('ကိုယ်ပိုင် Wallet / ငွေစာရင်း'),
            ),
          ],
        ]),
        if (session.isAdmin)
          SectionCard(title: 'Company Name', children: [
            Text('ပို့သော စာရင်းတိုင်း၏ ခေါင်းစဥ်တွင် ဤအမည် ပေါ်ပါမည်။', style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
            const SizedBox(height: 10),
            TextField(controller: _company, maxLength: 60, decoration: deco('Company Name')),
            const SizedBox(height: 6),
            FilledButton.icon(onPressed: companyBusy ? null : _saveCompany, icon: const Icon(Icons.save), label: const Text('သိမ်းမည်')),
          ]),
        SectionCard(title: 'KPay / WavePay (ငွေလွှဲရန်)', children: [
          Text('${session.roleName} အောက် တိုက်ရိုက်ရှိ အကောင့်များ ငွေဖြည့် စာမျက်နှာတွင် ဤနံပါတ်များကို မြင်ရပါမည်။',
              style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
          const SizedBox(height: 10),
          TextField(controller: _pay['kpay_no'], keyboardType: TextInputType.phone, decoration: deco('KPay ဖုန်းနံပါတ်')),
          const SizedBox(height: 10),
          TextField(controller: _pay['kpay_name'], decoration: deco('KPay အကောင့်အမည်')),
          const SizedBox(height: 10),
          TextField(controller: _pay['wave_no'], keyboardType: TextInputType.phone, decoration: deco('WavePay ဖုန်းနံပါတ်')),
          const SizedBox(height: 10),
          TextField(controller: _pay['wave_name'], decoration: deco('WavePay အကောင့်အမည်')),
          const SizedBox(height: 14),
          FilledButton.icon(onPressed: payBusy ? null : _savePay, icon: const Icon(Icons.save), label: const Text('သိမ်းမည်')),
        ]),
        SectionCard(title: 'စကားဝှက် ပြောင်းရန်', children: [
          pw(_current, 'လက်ရှိ စကားဝှက်'),
          const SizedBox(height: 12),
          pw(_next, 'စကားဝှက်အသစ် (အနည်းဆုံး ၆ လုံး)'),
          const SizedBox(height: 12),
          pw(_confirm, 'စကားဝှက်အသစ် ထပ်ရိုက်ပါ'),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: busy ? null : _changePassword,
            icon: const Icon(Icons.lock_reset),
            label: const Text('စကားဝှက် ပြောင်းမည်'),
          ),
        ]),
      ])),
    );
  }

  Widget _row(String label, Object? value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: Colors.grey[600]))),
          Expanded(child: Text(value == null || '$value'.isEmpty ? '-' : '$value', style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
      );
}
