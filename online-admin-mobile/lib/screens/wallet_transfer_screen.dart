import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import 'accounts_screen.dart' show roleNames;

// ငွေ Transfer — squares the accounts below back onto their float: the admin its masters, a master
// its own agents and users, an agent its users.
//
// An account's float ("ထည့်ပေးထားသော ငွေ") is the money this very upline has handed it. Its balance
// then drifts with its tree's wins and losses. Transfer puts each ticked account back on that
// float — what sits over it is taken back, what is short is topped up. The squaring moves are left
// out of the float itself, so the float stays the same figure week after week (src/routes/wallet.js).
//
// The weekly check boxes are the days this upline squares up on; they are saved on the server,
// today is marked, and a day that is not ticked only warns before the transfer goes through.
// A master / an agent pays the top-ups out of its own balance, so the server checks the whole round
// against it first and says so when it is short.
class WalletTransferScreen extends StatefulWidget {
  const WalletTransferScreen({super.key});

  @override
  State<WalletTransferScreen> createState() => _WalletTransferScreenState();
}

// ISO weekdays: 1 = Monday … 7 = Sunday (DateTime.weekday uses the same numbers).
const _days = [
  (1, 'တနင်္လာ'),
  (2, 'အင်္ဂါ'),
  (3, 'ဗုဒ္ဓဟူး'),
  (4, 'ကြာသပတေး'),
  (5, 'သောကြာ'),
  (6, 'စနေ'),
  (7, 'တနင်္ဂနွေ'),
];
String _dayName(int iso) => _days.firstWhere((d) => d.$1 == iso).$2;

class _WalletTransferScreenState extends State<WalletTransferScreen> {
  final _loader = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();
  final picked = <int>{};
  final chosenDays = <int>{};
  bool busy = false;

  int get today => DateTime.now().weekday;

  // What this screen lists, by signed-in role: the admin's masters, a master's agents and users,
  // an agent's users.
  String get whose {
    final s = context.read<Session>();
    return s.isAdmin ? 'Masters' : s.isMaster ? 'Agent / User' : 'Users';
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final r = await Api.instance.get('/wallet/float-targets') as Map;
    chosenDays
      ..clear()
      ..addAll(((r['days'] as List?) ?? const []).map(asInt));
    // accounts: masters for the admin, agents / users below a master, users below an agent.
    // ('masters' is the name the list had when only the admin had this screen.)
    final list = (r['accounts'] ?? r['masters']) as List;
    final masters = list.map((m) => Map<String, dynamic>.from(m as Map)).toList();
    picked.removeWhere((id) => !masters.any((m) => asInt(m['id']) == id));
    return masters;
  }

  // A master is squared up only when it has a float to go back on and is not already on it.
  bool _movable(Map<String, dynamic> m) => asInt(m['float_amount']) > 0 && asInt(m['delta']) != 0;

  Future<void> _saveDays(int iso, bool on) async {
    final before = {...chosenDays};
    setState(() => on ? chosenDays.add(iso) : chosenDays.remove(iso));
    try {
      await Api.instance.put('/wallet/float-days', {'days': chosenDays.toList()});
      if (mounted) {
        snack(context, chosenDays.isEmpty
            ? 'ငွေ Transfer ရက် မရွေးထားပါ'
            : 'ငွေ Transfer ရက်: ${(_days.where((d) => chosenDays.contains(d.$1)).map((d) => d.$2)).join(', ')}');
      }
    } catch (e) {
      if (mounted) {
        setState(() => chosenDays
          ..clear()
          ..addAll(before));
        errorSnack(context, e);
      }
    }
  }

  Future<void> _run(List<Map<String, dynamic>> masters) async {
    final rows = masters.where((m) => picked.contains(asInt(m['id']))).toList();
    if (rows.isEmpty) return;
    final money = context.read<Session>().money;
    final up = rows.where((m) => asInt(m['delta']) > 0).fold<int>(0, (a, m) => a + asInt(m['delta']));
    final down = rows.where((m) => asInt(m['delta']) < 0).fold<int>(0, (a, m) => a - asInt(m['delta']));
    final offDay = chosenDays.isNotEmpty && !chosenDays.contains(today);
    final ok = await confirm(
      context,
      'ငွေ Transfer — $whose ${rows.length} ဦး',
      message: [
        'ထည့်ပေးထားသော ငွေအတိုင်း ပြန်ထားပါမည်။',
        'ပိုသည် ပြန်နုတ် ${money(down)} ကျပ်',
        'လျော့သည် ပြန်ဖြည့် ${money(up)} ကျပ်',
        if (offDay) '\n⚠ ယနေ့ (${_dayName(today)}) သည် ရွေးထားသော ငွေ Transfer ရက် မဟုတ်ပါ။',
      ].join('\n'),
      ok: 'Transfer လုပ်မည်',
      danger: offDay,
    );
    if (!ok) return;
    setState(() => busy = true);
    try {
      final r = await Api.instance.post('/wallet/float-reset', {'user_ids': picked.toList()}) as Map;
      picked.clear();
      if (mounted) {
        snack(context, '${asInt(r['moved'])} ဦး ပြီးပါပြီ · ဖြည့် ${money(asInt(r['deposited']))} · နုတ် ${money(asInt(r['withdrawn']))} ကျပ်');
      }
      await _loader.currentState?.reload();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return Scaffold(
      appBar: AppBar(title: const Text('ငွေ Transfer')),
      body: Loader<List<Map<String, dynamic>>>(
        key: _loader,
        load: _load,
        builder: (ctx, masters, reload) {
          final selected = masters.where((m) => picked.contains(asInt(m['id']))).toList();
          final up = selected.where((m) => asInt(m['delta']) > 0).fold<int>(0, (a, m) => a + asInt(m['delta']));
          final down = selected.where((m) => asInt(m['delta']) < 0).fold<int>(0, (a, m) => a - asInt(m['delta']));
          final movable = masters.where(_movable).toList();
          return ContentWidth(
            maxWidth: 820,
            child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 90), children: [
              SectionCard(title: 'ငွေ Transfer လုပ်မည့် ရက်များ (အပါတ်စဥ်)', children: [
                Text(
                  '$whose တစ်ဦးချင်းကို ထည့်ပေးထားသော ငွေအတိုင်း ပြန်ထားပေးသည် — ပိုသည်ကို နုတ်၊ လျော့သည်ကို ဖြည့်။'
                  '${session.isAdmin ? '' : ' ပြန်ဖြည့်ငွေကို ကိုယ်ပိုင်လက်ကျန်မှ နုတ်ပါမည်။'}',
                  style: TextStyle(color: Colors.grey[700], fontSize: 12.5),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final d in _days)
                      FilterChip(
                        selected: chosenDays.contains(d.$1),
                        onSelected: (v) => _saveDays(d.$1, v),
                        label: Text(d.$1 == today ? '${d.$2} (ယနေ့)' : d.$2),
                        showCheckmark: true,
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  chosenDays.isEmpty
                      ? 'ရက် မရွေးထားပါ — အချိန်မရွေး Transfer လုပ်နိုင်သည်။'
                      : chosenDays.contains(today)
                          ? 'ယနေ့ (${_dayName(today)}) သည် လုပ်ရမည့် ရက် ဖြစ်ပါသည်။'
                          : 'ယနေ့ (${_dayName(today)}) မပါဝင်ပါ — Transfer လုပ်လျှင် သတိပေးပါမည်။',
                  style: TextStyle(color: Colors.grey[700], fontSize: 12.5),
                ),
              ]),
              SectionCard(
                title: '$whose (${masters.length})',
                trailing: movable.isEmpty
                    ? null
                    : TextButton(
                        onPressed: () => setState(() {
                          final all = picked.length == movable.length;
                          picked.clear();
                          if (!all) picked.addAll(movable.map((m) => asInt(m['id'])));
                        }),
                        child: Text(picked.length == movable.length ? 'အားလုံး ဖြုတ်' : 'အားလုံးရွေး'),
                      ),
                children: [
                  if (masters.isEmpty)
                    const Padding(padding: EdgeInsets.all(12), child: Text('အကောင့် မရှိသေးပါ', style: TextStyle(color: Colors.grey))),
                  for (final m in masters)
                    () {
                      final float = asInt(m['float_amount']);
                      final delta = asInt(m['delta']);
                      final can = _movable(m);
                      return CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: picked.contains(asInt(m['id'])),
                        onChanged: can && !busy
                            ? (v) => setState(() => v == true ? picked.add(asInt(m['id'])) : picked.remove(asInt(m['id'])))
                            : null,
                        title: Text('${m['username']} · ${m['name']}'
                            '${session.isMaster && m['role'] != null ? '  ·  ${roleNames[m['role']] ?? m['role']}' : ''}',
                            style: const TextStyle(fontWeight: FontWeight.w800)),
                        subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('ထည့်ပေးထားသော ငွေ ${session.money(float)} · လက်ကျန် ${session.money(asInt(m['balance']))} ကျပ်'),
                          Text(
                            float <= 0
                                ? 'ထည့်ပေးထားသော ငွေ မရှိပါ'
                                : delta == 0
                                    ? '✓ အတိအကျ ရှိပြီး'
                                    : delta > 0
                                        ? 'ပြန်ဖြည့် ${session.money(delta)} ကျပ်'
                                        : 'ပြန်နုတ် ${session.money(-delta)} ကျပ်',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              color: float <= 0 || delta == 0
                                  ? Colors.grey[600]
                                  : delta > 0
                                      ? const Color(0xFF059669)
                                      : const Color(0xFFEA580C),
                            ),
                          ),
                        ]),
                      );
                    }(),
                ],
              ),
              if (selected.isNotEmpty)
                SectionCard(children: [
                  Text('ရွေးထား ${selected.length} ဦး', style: const TextStyle(fontWeight: FontWeight.w800)),
                  Text('ပြန်ဖြည့် ${session.money(up)} · ပြန်နုတ် ${session.money(down)} ကျပ်', style: TextStyle(color: Colors.grey[700])),
                ]),
            ]),
          );
        },
      ),
      floatingActionButton: picked.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: busy ? null : () => _run(_loader.currentState?.data ?? const []),
              icon: const Icon(Icons.swap_horiz),
              label: Text(busy ? 'လုပ်နေသည်…' : 'ငွေ Transfer (${picked.length})'),
            ),
    );
  }
}
