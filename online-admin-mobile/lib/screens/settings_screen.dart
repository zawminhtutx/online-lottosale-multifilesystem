import 'package:flutter/material.dart';

import '../services/api.dart';
import '../widgets/common.dart';
import 'printer_settings_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _loading = true;
  String? _error;
  bool _busy = false;

  bool _allowAgentCommission = false;
  bool _allowPrizeAssign = false;
  String _walletDisplay = 'upline'; // 'upline' | 'master'
  bool _allowNameEdit = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/master-settings') as Map);
      if (mounted) {
        setState(() {
          _allowAgentCommission = d['allow_agent_commission'] == true;
          _allowPrizeAssign = d['allow_prize_assign'] == true;
          _walletDisplay = d['user_wallet_display'] == 'master' ? 'master' : 'upline';
          _allowNameEdit = d['allow_name_edit'] == true;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) { setState(() { _error = '$e'; _loading = false; }); }
    }
  }

  Future<void> _save(Map<String, dynamic> patch) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final d = Map<String, dynamic>.from(await Api.instance.put('/master-settings', patch) as Map);
      if (mounted) {
        setState(() {
          _allowAgentCommission = d['allow_agent_commission'] == true;
          _allowPrizeAssign = d['allow_prize_assign'] == true;
          _walletDisplay = d['user_wallet_display'] == 'master' ? 'master' : 'upline';
          _allowNameEdit = d['allow_name_edit'] == true;
        });
      }
    } catch (e) {
      if (mounted) { errorSnack(context, e); }
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : ListView(children: [
                  // Printer
                  _section('Printer'),
                  ListTile(
                    leading: const Icon(Icons.print_outlined),
                    title: const Text('Printer Settings'),
                    subtitle: const Text('Bluetooth printer ချိတ်ဆက်ရန်'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrinterSettingsScreen())),
                  ),

                  // Agent permissions
                  _section('Agent ခွင့်ပြုချက်များ'),
                  SwitchListTile(
                    secondary: const Icon(Icons.percent),
                    title: const Text('Agent ကော်မရှင် ပြင်ခွင့်'),
                    subtitle: const Text('Agent တွေ ကိုယ်ပိုင် commission ပြင်နိုင်မည်'),
                    value: _allowAgentCommission,
                    onChanged: _busy ? null : (v) => _save({'allow_agent_commission': v}),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.link),
                    title: const Text('အလျော်အဆတွဲ ခွင့်ပြု'),
                    subtitle: const Text('Agent တွေ prize set သတ်မှတ်ပေးနိုင်မည်'),
                    value: _allowPrizeAssign,
                    onChanged: _busy ? null : (v) => _save({'allow_prize_assign': v}),
                  ),

                  // User display
                  _section('ထိုးသားများ ဆက်တင်'),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                    child: Text('Wallet ဘယ်သူ့ကို ပြမည်', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey[600])),
                  ),
                  RadioGroup<String>(
                    groupValue: _walletDisplay,
                    onChanged: (v) { if (!_busy && v != null) { _save({'user_wallet_display': v}); } },
                    child: Column(
                      children: const [
                        RadioListTile<String>(
                          title: Text('မိမိ Upline Wallet (ပုံမှန်)'),
                          subtitle: Text('User→Agent, Agent→Master wallet မြင်ရမည်'),
                          value: 'upline',
                        ),
                        RadioListTile<String>(
                          title: Text('Master Wallet'),
                          subtitle: Text('User အားလုံး master ရဲ့ wallet နံပါတ်မြင်ရမည်'),
                          value: 'master',
                        ),
                      ],
                    ),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.store_outlined),
                    title: const Text('User ဆိုင်အမည် ပြောင်းခွင့်'),
                    subtitle: const Text('User တွေ ကိုယ်ပိုင် ဆိုင်အမည် ပြင်နိုင်မည်'),
                    value: _allowNameEdit,
                    onChanged: _busy ? null : (v) => _save({'allow_name_edit': v}),
                  ),

                  if (_busy) const LinearProgressIndicator(),
                ]),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text(title, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Colors.grey[600], letterSpacing: .5)),
      );
}
