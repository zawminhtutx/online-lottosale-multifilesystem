import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// The master's own recipient list.  The server sends close-time ledgers only to these addresses;
// agent/user profile email addresses are deliberately not used.
class LedgerEmailScreen extends StatefulWidget {
  const LedgerEmailScreen({super.key});

  @override
  State<LedgerEmailScreen> createState() => _LedgerEmailScreenState();
}

class _LedgerEmailScreenState extends State<LedgerEmailScreen> {
  final _email = TextEditingController();
  final _emails = <String>[];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final raw = '${context.read<Session>().user?['ledger_recipients'] ?? ''}';
    _emails.addAll(
      raw
          .split(RegExp(r'[,;\r\n]+'))
          .map((value) => value.trim().toLowerCase())
          .where((value) => value.isNotEmpty)
          .toSet(),
    );
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  bool _valid(String email) =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email);

  void _add() {
    final email = _email.text.trim().toLowerCase();
    if (!_valid(email)) {
      return errorSnack(context, 'Email address ပုံစံမမှန်ပါ');
    }
    if (_emails.contains(email)) {
      return errorSnack(context, 'ဤ email ကို စာရင်းထဲထည့်ပြီးဖြစ်သည်');
    }
    if (_emails.length >= 30) {
      return errorSnack(context, 'Email 30 ခုအထိသာ ထည့်နိုင်သည်');
    }
    setState(() {
      _emails.add(email);
      _email.clear();
    });
  }

  Future<void> _save() async {
    final session = context.read<Session>();
    setState(() => _saving = true);
    try {
      final saved =
          await Api.instance.patch('/users/${session.id}', {
                'ledger_recipients': _emails.join('\n'),
              })
              as Map;
      session.setUser(Map<String, dynamic>.from(saved));
      if (mounted) snack(context, 'Ledger email list ကို သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Ledger Email')),
    body: ContentWidth(
      maxWidth: 680,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          SectionCard(
            children: [
              Text(
                'အပါတ်စဉ်ပိတ်ချိန်တွင် လယ်ဂျာပို့မည့် email များကို စီမံပါ။ User/Agent account email များသို့ အလိုအလျောက် မပို့ပါ။',
                style: TextStyle(color: Colors.grey[700]),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _add(),
                      decoration: const InputDecoration(
                        labelText: 'Email address',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(
                    onPressed: _add,
                    icon: const Icon(Icons.add),
                    label: const Text('Add'),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (_emails.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: Text('Email မထည့်ရသေးပါ')),
                )
              else
                ..._emails.map(
                  (email) => Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: const Icon(Icons.email_outlined),
                      title: Text(email),
                      trailing: IconButton(
                        tooltip: 'Remove',
                        icon: const Icon(
                          Icons.remove_circle_outline,
                          color: Colors.red,
                        ),
                        onPressed: () => setState(() => _emails.remove(email)),
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.save),
                label: const Text('သိမ်းမည်'),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
