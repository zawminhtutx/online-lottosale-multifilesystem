import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../models/pattern_entry.dart';
import '../services/api.dart';
import '../services/format.dart';
import '../services/pattern_parser.dart';
import '../services/responsive.dart';
import '../services/live.dart';
import '../services/session.dart';
import '../services/slip_text.dart';
import '../services/sound_service.dart';
import '../widgets/common.dart';
import '../widgets/dash_style.dart';
import '../widgets/hot_marquee.dart';
import 'pattern_keypad_sheet.dart';
import 'sale_ledger_screen.dart';
import 'slips_screen.dart';

// Sale — the POS mobile app's Sale screen for one online term: the cart table (စဥ် / ဂဏန်း /
// ယူနစ် / ပြင်/ဖျက်), the pattern keypad (every POS pattern: R, P, SS, 1P, N, W, ...), and the
// total + ထိုးမည် bar. Each entry is checked with the server's dry run as it is added (unit
// break, the user's own per-number limit, balance), and the slip is saved with POST /tickets.
const _cartHeadStyle = TextStyle(color: Color(0xFF1E1B4B), fontWeight: FontWeight.w700, fontSize: 15);

class BetScreen extends StatefulWidget {
  final int termId;
  const BetScreen({super.key, required this.termId});

  @override
  State<BetScreen> createState() => _BetScreenState();
}

class _BetScreenState extends State<BetScreen> {
  Map<String, dynamic>? term;
  Map<String, dynamic>? betType; // the term's one bet type (2D or 3D)
  List<Map<String, dynamic>> customers = [];
  int? customerId;
  bool saveOver = false;
  final List<PatternEntry> cart = [];
  final Set<PatternEntry> expandedEntries = {};
  bool loading = true;
  bool busy = false;
  String? loadError;
  bool timeExpired = false;
  bool keypadDocked = false;
  bool showDockedKeypad = false;
  Timer? _closeTimer;
  // The last saved slip — what the send icon shares.
  Map<String, dynamic>? lastTicket;
  final Map<String, int> ledgerUnits = {};
  final Map<String, int> purchased = {};
  void Function()? _stopLive;

  int get digits => asInt(betType?['digits']) == 3 ? 3 : 2;
  int get unitPrice => asInt(term?['unit_price']);
  int get grandUnits => cart.fold(0, (s, e) => s + e.unit.round() * e.numbers.length);
  int get grandTotal => grandUnits * unitPrice;

  @override
  void initState() {
    super.initState();
    _load();
    // Enforces the close time within 30s even if the user never leaves this screen.
    _closeTimer = Timer.periodic(const Duration(seconds: 30), (_) => _checkClosed());
    _stopLive = Live.instance.listen('tickets', (m) {
      if (m['reconnected'] == true || m['term_id'] == null || asInt(m['term_id']) == widget.termId) {
        _loadLedger();
      }
    });
  }

  @override
  void dispose() {
    _closeTimer?.cancel();
    _stopLive?.call();
    super.dispose();
  }

  Map<String, dynamic>? get customer {
    if (customerId == null) return null;
    for (final u in customers) {
      if (asInt(u['id']) == customerId) return u;
    }
    return customers.isEmpty ? null : customers.first;
  }

  int get breakCap {
    final typeId = asInt(betType?['id']);
    for (final raw in (term?['limits'] as List? ?? const [])) {
      final l = raw as Map;
      if (asInt(l['bet_type_id']) == typeId) return asInt(l['max_units']);
    }
    return 0;
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final results = await Future.wait([
        Api.instance.get('/terms/${widget.termId}'),
        Api.instance.get('/meta'),
        Api.instance.get('/users?role=user'),
      ]);
      term = Map<String, dynamic>.from(results[0] as Map);
      final types = ((results[1] as Map)['bet_types'] as List).map((t) => Map<String, dynamic>.from(t as Map)).toList();
      final want = term!['game'] == '3D' ? 3 : 2;
      betType = types.firstWhere((t) => asInt(t['digits']) == want, orElse: () => types.first);
      customers = (results[2] as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .where((u) => u['status'] == 'active')
          .toList();
      if (customerId == null || !customers.any((u) => asInt(u['id']) == customerId)) {
        customerId = customers.isEmpty ? null : asInt(customers.first['id']);
      }
      loadError = customers.isEmpty ? 'ရောင်းရန် ကစားသမား မရှိပါ' : null;
      _checkClosed();
      await _loadLedger();
    } catch (e) {
      loadError = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  void _checkClosed() {
    final t = term;
    if (t == null) return;
    final expired = !isTermOpen(t);
    if (expired != timeExpired && mounted) setState(() => timeExpired = expired);
  }

  Future<void> _loadLedger() async {
    if (term == null || betType == null) return;
    final d = digits;
    final typeId = asInt(betType!['id']);
    try {
      final rows = (await Api.instance.get('/terms/${widget.termId}/exposure?bet_type_id=$typeId') as List)
          .map((r) => Map<String, dynamic>.from(r as Map));
      ledgerUnits
        ..clear()
        ..addEntries(rows.map((r) => MapEntry('${r['number']}'.padLeft(d, '0'), asInt(r['units']))));
    } catch (_) {}
    if (!mounted) return;
    purchased.clear();
    if (manages(term)) {
      try {
        final view = Map<String, dynamic>.from(await Api.instance.get('/terms/${widget.termId}/purchases') as Map);
        for (final raw in (view['purchases'] as List? ?? const [])) {
          final p = raw as Map;
          if (asInt(p['bet_type_id']) != typeId) continue;
          final num = '${p['number']}'.padLeft(d, '0');
          purchased[num] = (purchased[num] ?? 0) + asInt(p['units']);
        }
      } catch (_) {}
    }
    if (mounted) setState(() {});
  }

  Map<String, int> _cartUnits() {
    final m = <String, int>{};
    for (final e in cart) {
      for (final n in e.numbers) {
        m[n] = (m[n] ?? 0) + e.unit.round();
      }
    }
    return m;
  }

  Future<void> _openLedger() async {
    if (term == null || betType == null) return;
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => SaleLedgerScreen(
        termId: widget.termId,
        betTypeId: asInt(betType!['id']),
        digits: digits,
        breakCap: breakCap,
        cartUnits: _cartUnits(),
        showPurchases: manages(term),
      ),
    ));
    if (mounted) _loadLedger();
  }

  Future<void> _showCustomerPicker() async {
    if (customers.isEmpty) return;
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: const Color(0xFF1E1B4B),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) {
        return SizedBox(
          height: MediaQuery.of(ctx).size.height * 0.55,
          child: Column(children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Text('ကစားသမား ရွေးရန်', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: customers.length,
                itemBuilder: (ctx, i) {
                  final u = customers[i];
                  final id = asInt(u['id']);
                  final name = '${u['name'] ?? ''}';
                  return ListTile(
                    selected: id == customerId,
                    selectedTileColor: Colors.white10,
                    title: Text('${u['username']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                    subtitle: name.isEmpty ? null : Text(name, style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    trailing: id == customerId ? const Icon(Icons.check, color: Colors.white) : null,
                    onTap: () => Navigator.pop(ctx, id),
                  );
                },
              ),
            ),
          ]),
        );
      },
    );
    if (picked != null) await _pickCustomer(picked);
  }

  Future<void> _pickCustomer(int id) async {
    if (id == customerId) return;
    if (cart.isNotEmpty) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('ကစားသမား ပြောင်းမလား?'),
          content: const Text('မသိမ်းရသေးသော ကြောင်းများ ပျက်ပါမည်။'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ပြောင်းမည်')),
          ],
        ),
      );
      if (ok != true) return;
      cart.clear();
      expandedEntries.clear();
    }
    setState(() => customerId = id);
  }

  Future<void> _editBreak() async {
    if (!manages(term) || term == null || betType == null) return;
    final status = '${term!['status']}';
    if (const {'drawn', 'settled', 'cancelled'}.contains(status)) {
      _snack('ဒီအပါတ်စဥ် ဘရိတ် ပြင်လို့ မရတော့ပါ', Colors.red);
      return;
    }
    final typeId = asInt(betType!['id']);
    final ctrl = TextEditingController(text: '$breakCap');
    final next = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ဘရိတ် ပြင်မည်'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: '${betType!['description']} — ဂဏန်းတစ်ကွက် အများဆုံး ယူနစ်',
            helperText: '0 = ကန့်သတ်ချက်မရှိ',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(
            onPressed: () {
              final n = int.tryParse(ctrl.text.trim());
              if (n == null || n < 0) return;
              Navigator.pop(ctx, n);
            },
            child: const Text('သိမ်းမည်'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (next == null || !mounted) return;
    try {
      final keep = <int, int>{
        for (final raw in (term?['limits'] as List? ?? const []))
          asInt((raw as Map)['bet_type_id']): asInt(raw['max_units']),
      };
      if (next > 0) {
        keep[typeId] = next;
      } else {
        keep.remove(typeId);
      }
      await Api.instance.put('/terms/${widget.termId}/limits', [
        for (final e in keep.entries) {'bet_type_id': e.key, 'max_units': e.value},
      ]);
      term = Map<String, dynamic>.from(await Api.instance.get('/terms/${widget.termId}') as Map);
      if (!mounted) return;
      snack(context, 'ဘရိတ် သိမ်းပြီးပါပြီ');
      await _loadLedger();
    } catch (e) {
      if (mounted) _snack('$e', Colors.red);
    }
  }

  Future<void> _buyExtras() async {
    if (!manages(term)) return;
    try {
      final data = Map<String, dynamic>.from(await Api.instance.get('/terms/${widget.termId}/purchases') as Map);
      if (data['has_results'] == true) {
        _snack('ပေါက်သီး ထည့်ပြီးနောက် အဝယ် အသစ် မရိုက်နိုင်ပါ။', Colors.red);
        return;
      }
      final items = [
        for (final raw in (data['excess'] as List? ?? const []))
          if (asInt((raw as Map)['excess']) > 0)
            {'bet_type_id': asInt(raw['bet_type_id']), 'number': raw['number'], 'units': asInt(raw['excess'])},
      ];
      if (items.isEmpty) {
        _snack('ကျွံဂဏန်း မရှိပါ', Colors.red);
        return;
      }
      if (!mounted) return;
      final units = items.fold<int>(0, (a, i) => a + (i['units'] as int));
      final money = context.read<Session>().money;
      if (!await confirm(context, 'အဝယ် သွင်း',
          message: 'ကျွံဂဏန်း ${items.length} လုံး · ${money(units)} ယူနစ် (${money(units * asInt(data['unit_price']))} Ks) ကို အဝယ်သွင်းမလား?',
          ok: 'အဝယ် သွင်း')) {
        return;
      }
      await Api.instance.post('/terms/${widget.termId}/purchases', {'items': items});
      if (!mounted) return;
      snack(context, 'အဝယ် သိမ်းပြီး');
      await _loadLedger();
    } catch (e) {
      if (mounted) _snack('$e', Colors.red);
    }
  }

  List<Map<String, Object>> _entries(List<PatternEntry> list) => [
        for (final e in list)
          {
            'bet_type_id': asInt(betType!['id']),
            // The server keeps the typed pattern as the group label; the numbers are sent expanded.
            'input': RegExp(r'^[0-9A-Za-z*]{1,12}$').hasMatch(e.key) ? e.key : e.numbers.first,
            'numbers': e.numbers,
            'units': e.unit.round(),
          },
      ];

  // The keypad asks before adding an entry. Only local checks here — nothing is sent to the
  // server while typing; Save sends the slip once and the server checks it then (unit break,
  // Max Unit, hot %, closed numbers, balance). [replacing] is kept for the callers' signature.
  Future<bool> _checkEntry(List<String> numbers, double unit, {PatternEntry? replacing}) async {
    if (unit % 1 != 0) {
      _snack('ယူနစ်ကို ကိန်းပြည့်ဖြင့် ထည့်ပါ', Colors.red);
      return false;
    }
    if (timeExpired) {
      _snack('ပိတ်ချိန်ရောက်ပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ', Colors.red);
      return false;
    }
    return true;
  }

  void _openKeypad() {
    if (timeExpired) return;
    if (keypadDocked) {
      setState(() => showDockedKeypad = true);
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width, maxHeight: MediaQuery.of(context).size.height * 0.72),
      backgroundColor: const Color(0xFFF4F3FF),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => PatternKeypadSheet(
        digits: digits,
        cart: cart,
        onChanged: () => setState(() {}),
        checkBreakLimit: (n, u) => _checkEntry(n, u),
        onShowFullNumbers: _showFullNumbers,
        docked: false,
        onToggleDock: () {
          Navigator.pop(ctx);
          setState(() {
            keypadDocked = true;
            showDockedKeypad = true;
          });
        },
        onSubmitSale: submit,
      ),
    );
  }

  // Numbers already at the unit break for this term (from the server).
  Future<void> _showFullNumbers() async {
    List<Map<String, dynamic>> full;
    try {
      full = ((await Api.instance.get('/terms/${widget.termId}/full-numbers')) as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
    } catch (e) {
      _snack('$e', Colors.red);
      return;
    }
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ဘရိတ်ပြည့်နေသော ဂဏန်းများ'),
        content: SizedBox(
          width: double.maxFinite,
          height: 320,
          child: full.isEmpty
              ? const Center(child: Text('မရှိပါ', style: TextStyle(color: Colors.grey)))
              : LayoutBuilder(builder: (ctx, constraints) {
                  final crossAxisCount = Responsive.columnsForWidth(constraints.maxWidth, idealCellWidth: 68, minCount: 3, maxCount: 8);
                  return GridView.builder(
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: crossAxisCount, mainAxisSpacing: 6, crossAxisSpacing: 6, childAspectRatio: 1.4),
                    itemCount: full.length,
                    itemBuilder: (ctx, idx) => Container(
                      decoration: BoxDecoration(
                        color: Colors.red.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.red),
                      ),
                      alignment: Alignment.center,
                      child: Text('${full[idx]['number']}',
                          style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w800, fontSize: 14, color: Colors.red)),
                    ),
                  );
                }),
        ),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _editEntry(PatternEntry e) async {
    final ctrl = TextEditingController(text: '${e.unit.round()}');
    final next = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('ပြင်ရန် — ${e.grouptype != null ? patternLabel(e.key) : e.key}'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'ယူနစ်', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, int.tryParse(ctrl.text.trim())), child: const Text('OK')),
        ],
      ),
    );
    if (next == null || next <= 0) return;
    final ok = await _checkEntry(e.numbers, next.toDouble(), replacing: e);
    if (ok) setState(() => e.unit = next.toDouble());
  }

  // ခွဲမည် (ungroup): one cart line that holds several numbers — R, အခွေ, စီးရီး, ဘရိတ် … — becomes a
  // line per number, each keeping the same unit, so one number can be given its own unit or
  // dropped without losing the rest. The pattern is only a label; the slip carries the numbers
  // either way (see _entries), so nothing about what is sold changes.
  Future<void> _ungroupEntry(PatternEntry e) async {
    final nums = splitGroupNumbers(e.key, List<String>.from(e.numbers), digits);
    if (nums.length < 2) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ungroup လုပ်မှာလား?'),
        content: Text('${patternLabel(e.key)} · ဂဏန်း ${e.numbers.length} လုံးကို တစ်ကွက်ချင်း ခွဲမည်။'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final idx = cart.indexWhere((item) => identical(item, e));
    if (idx < 0) return;
    final replacements = [
      for (final n in nums) PatternEntry(key: n, numbers: [n], unit: e.unit, discount: e.discount, note: e.note),
    ];
    setState(() {
      expandedEntries.remove(e);
      cart.replaceRange(idx, idx + 1, replacements);
    });
  }

  Future<void> _deleteEntry(PatternEntry e) async {
    if (e.numbers.length > 1) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Group ဖျက်မှာလား?'),
          content: Text('${patternLabel(e.key)} · ဂဏန်း ${e.numbers.length} လုံး တစ်ခါတည်း ပျက်ပါမည်။ ခွဲချင်ရင် ဂဏန်းရှေ့ group icon ကို နှိပ်ပါ။'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ဖျက်မည်')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    SoundService.instance.delete();
    setState(() {
      cart.remove(e);
      expandedEntries.remove(e);
    });
  }

  void _toggleExpand(PatternEntry e) => setState(() {
        if (!expandedEntries.remove(e)) expandedEntries.add(e);
      });

  Future<void> submit() async {
    if (busy || cart.isEmpty || customerId == null) return;
    _checkClosed();
    if (timeExpired) {
      _snack('ပိတ်ချိန်ရောက်သွားပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ', Colors.red);
      return;
    }
    final session = context.read<Session>();
    setState(() => busy = true);
    try {
      final ticket = Map<String, dynamic>.from(await Api.instance.post('/tickets', {
        'term_id': widget.termId,
        'user_id': customerId,
        'entries': _entries(cart),
        if ((session.canSaveOver || manages(term) || asInt(customer?['sale_over']) == 1) && saveOver) 'save_over': true,
      }) as Map);
      // Cleared in place: an open keypad (docked or pop-up) holds this same list and stays open
      // after a save for the next slip.
      cart.clear();
      expandedEntries.clear();
      lastTicket = ticket;
      SoundService.instance.submit();
      await session.refresh();
      await _refreshCustomer();
      _snack('Slip #${ticket['slip_no']} သိမ်းပြီးပါပြီ — ${session.money(asInt(ticket['net_amount']))} ကျပ်', Colors.teal);
      await _loadLedger();
      await _showAdjustments(ticket);
    } catch (e) {
      // The server's checks (break, Max Unit, hot %, balance …) show up here, at Save.
      if (mounted) {
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Row(children: [Icon(Icons.block, color: Colors.red), SizedBox(width: 8), Text('မသိမ်းနိုင်ပါ')]),
            content: Text('$e'),
            actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // Numbers the server cut down or left out when saving (closed / break / Max Unit / hot).
  Future<void> _showAdjustments(Map<String, dynamic> ticket) async {
    final list = (ticket['adjustments'] as List? ?? const []).cast<Map>();
    if (list.isEmpty || !mounted) return;
    // "00 - မရ" when nothing was taken, "11 - 950 မရ" for the units that were not taken.
    String text(Map a) {
      final saved = asInt(a['saved']);
      return saved > 0 ? '${asInt(a['requested']) - saved} မရ' : 'မရ';
    }

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('မရဂဏန်းများ'),
        content: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            for (final a in list)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: '${a['number']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                  TextSpan(text: ' - ${text(a)}'),
                ])),
              ),
          ]),
        ),
        actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }

  Future<void> _refreshCustomer() async {
    final id = customerId;
    if (id == null) return;
    try {
      final u = Map<String, dynamic>.from(await Api.instance.get('/users/$id') as Map);
      final i = customers.indexWhere((c) => asInt(c['id']) == id);
      if (i >= 0) customers[i] = u;
    } catch (_) {}
  }

  Future<void> _printLastSlip() async {
    if (lastTicket == null) return;
    _snack('ပရင့်ထုတ်ရန် ဤ app တွင် Bluetooth printer မပါသေးပါ — Send ဖြင့် ပို့ပါ', Colors.orange);
  }

  Future<void> _sendLastSlip() async {
    final t = lastTicket;
    if (t == null) return;
    final money = context.read<Session>().money;
    await SharePlus.instance.share(ShareParams(text: slipText(t, term: term, money: money)));
  }

  void _snack(String message, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: color));
  }

  // Back gesture / system back: the first only warns, a second within 2 seconds leaves the sale
  // screen (so a stray swipe doesn't drop a slip being entered). The app bar's ← leaves at once.
  DateTime? _lastBack;
  Future<void> _openSlips() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SlipsScreen()));
    if (mounted) _load();
  }

  void _onBack(bool didPop) {
    if (didPop) return;
    final now = DateTime.now();
    if (_lastBack != null && now.difference(_lastBack!) < const Duration(seconds: 2)) {
      Navigator.of(context).pop();
      return;
    }
    _lastBack = now;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('ထွက်ရန် နောက်တစ်ကြိမ် ပြန်နှိပ်ပါ'), duration: Duration(seconds: 2)));
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final t = term;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) => _onBack(didPop),
      // Dashboard look: indigo gradient behind a transparent app bar; the sale table sits on a white panel.
      child: Scaffold(
      backgroundColor: Dash.bottom,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        foregroundColor: Colors.white,
        leading: BackButton(onPressed: () => Navigator.of(context).pop()),
        title: Text(t == null ? 'အရောင်း' : '${t['description']}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
        actions: [
          if (t != null)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(30)),
              child: Text('${session.money(asInt(customer?['balance']))} Ks${asInt(customer?['unlimited']) == 1 ? ' ∞' : ''}',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
            ),
          // စလစ်: the slips screen on top of this one — the cart stays as it is, and the balance
          // is read again on the way back (a slip may have been cancelled there). The term and the
          // ledger come in live over the WebSocket, so there is no Refresh button to press.
          if (manages(t)) GlassButton(icon: Icons.tune, label: 'ဘရိတ်', onPressed: _editBreak),
          const SizedBox(width: 12),
        ],
      ),
      floatingActionButton: timeExpired || t == null
          ? null
          : Padding(
              padding: const EdgeInsets.only(bottom: 105),
              child: FloatingActionButton(
                backgroundColor: Dash.ink,
                onPressed: _openKeypad,
                child: const Icon(Icons.keyboard_alt_outlined, color: Colors.white),
              ),
            ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      bottomSheet: keypadDocked && showDockedKeypad && !timeExpired
          ? Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF4F3FF),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
              ),
              // Tall enough for every key row at full size on a normal phone; on a shorter
              // screen the keypad scales itself down to what is here (PatternKeypadSheet).
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.72),
              child: PatternKeypadSheet(
                digits: digits,
                cart: cart,
                onChanged: () => setState(() {}),
                checkBreakLimit: (n, u) => _checkEntry(n, u),
                onShowFullNumbers: _showFullNumbers,
                docked: true,
                onToggleDock: () => setState(() => keypadDocked = false),
                onSubmitSale: submit,
              ),
            )
          : null,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Dash.top, Dash.bottom]),
        ),
        child: SafeArea(
          bottom: false,
          child: loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.cloud_off, color: Dash.red, size: 40),
                      const SizedBox(height: 10),
                      Text(loadError!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                      const SizedBox(height: 14),
                      FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: Dash.ink), onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('ပြန်ကြိုးစားရန်')),
                    ]),
                  ),
                )
              : Column(children: [
                  if (term != null) HotMarquee(term: term!),
                  _customerBar(session),
                  if (timeExpired)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.fromLTRB(12, 10, 12, 4),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: [Colors.red.shade800, Colors.red]),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text('🔴 ပိတ်ချိန်ရောက်ပါပြီ — ဒီအပါတ်စဥ်အတွက် မထိုးနိုင်တော့ပါ',
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                    ),
                  // Term strip: type, unit price, closing countdown.
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
                      decoration: Dash.glassBox(radius: 16),
                      child: Row(children: [
                        GameCircle('${t?['game']}', radius: 14),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text('${betType?['description'] ?? ''}',
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                              overflow: TextOverflow.ellipsis),
                        ),
                        if (manages(t)) ...[
                          GlassButton(icon: Icons.shopping_bag_outlined, label: 'အဝယ်', onPressed: _buyExtras),
                          const SizedBox(width: 6),
                        ],
                        GlassButton(icon: Icons.receipt_long, label: 'စလစ်', onPressed: _openSlips),
                      ]),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: _saleTable(session),
                    ),
                  ),
                ]),
        ),
      ),
      ),
    );
  }

  Widget _customerBar(Session session) {
    if (customers.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      child: Row(children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.only(left: 10),
            decoration: Dash.glassBox(radius: 16),
            child: Row(children: [
              Expanded(
                child: Autocomplete<Map<String, dynamic>>(
                  key: ValueKey(customerId),
                  initialValue: TextEditingValue(text: '${customer?['username'] ?? ''}'),
                  displayStringForOption: (u) => '${u['username']}',
                  optionsBuilder: (v) {
                    final q = v.text.trim().toLowerCase();
                    if (q.isEmpty) return customers;
                    final start = <Map<String, dynamic>>[];
                    final rest = <Map<String, dynamic>>[];
                    for (final u in customers) {
                      final un = '${u['username']}'.toLowerCase();
                      if (un.startsWith(q)) {
                        start.add(u);
                      } else if (un.contains(q) || '${u['name']}'.toLowerCase().contains(q)) {
                        rest.add(u);
                      }
                    }
                    return [...start, ...rest];
                  },
                  onSelected: (u) => _pickCustomer(asInt(u['id'])),
                  fieldViewBuilder: (ctx, controller, focus, onFieldSubmitted) {
                    return TextField(
                      controller: controller,
                      focusNode: focus,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14),
                      cursorColor: Colors.white,
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        isDense: true,
                        hintText: 'ကစားသမား',
                        hintStyle: TextStyle(color: Colors.white70),
                      ),
                      onSubmitted: (text) {
                        final q = text.trim().toLowerCase();
                        Map<String, dynamic>? match;
                        for (final u in customers) {
                          if ('${u['username']}'.toLowerCase() == q) {
                            match = u;
                            break;
                          }
                        }
                        match ??= customers.where((u) => '${u['username']}'.toLowerCase().startsWith(q)).firstOrNull;
                        if (match != null) {
                          onFieldSubmitted();
                          _pickCustomer(asInt(match['id']));
                        } else {
                          controller.text = '${customer?['username'] ?? ''}';
                        }
                      },
                    );
                  },
                  optionsViewBuilder: (ctx, onSelected, options) {
                    return Align(
                      alignment: Alignment.topLeft,
                      child: Material(
                        color: const Color(0xFF1E1B4B),
                        elevation: 8,
                        borderRadius: BorderRadius.circular(12),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 240, maxWidth: 280),
                          child: ListView(
                            padding: EdgeInsets.zero,
                            shrinkWrap: true,
                            children: [
                              for (final u in options)
                                ListTile(
                                  dense: true,
                                  title: Text('${u['username']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                                  onTap: () => onSelected(u),
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              IconButton(
                tooltip: 'ကစားသမား ရွေးရန်',
                onPressed: _showCustomerPicker,
                icon: const Icon(Icons.arrow_drop_down, color: Colors.white, size: 28),
              ),
            ]),
          ),
        ),
        const SizedBox(width: 8),
        GlassButton(icon: Icons.list_alt, label: 'Ledger', onPressed: _openLedger),
      ]),
    );
  }

  // Current-sale table: စဥ် / ဂဏန်း / ယူနစ် / ပြင်/ဖျက် (newest on top), like the POS app.
  Widget _saleTable(Session session) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      child: Column(children: [
      Container(
        height: 40,
        color: const Color(0xFFE4E4FB),
        child: const Row(children: [
          Expanded(flex: 1, child: Center(child: Text('စဥ်', style: _cartHeadStyle))),
          Expanded(flex: 3, child: Center(child: Text('ဂဏန်း', style: _cartHeadStyle))),
          Expanded(flex: 3, child: Center(child: Text('ယူနစ်', style: _cartHeadStyle))),
          Expanded(flex: 3, child: Center(child: Text('ပြင်/ဖျက်', style: _cartHeadStyle))),
        ]),
      ),
      Expanded(
        child: cart.isEmpty
            ? Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.keyboard_alt_outlined, size: 56, color: Color(0xFFC7C5F0)),
                  const SizedBox(height: 10),
                  Text('ဂဏန်းထည့်ရန် အောက်ခြေ ခလုတ်ကို နှိပ်ပါ',
                      style: const TextStyle(color: Color(0xFF8B88C9), fontSize: 13.5, fontWeight: FontWeight.w600)),
                ]),
              )
            : ListView.separated(
                itemCount: cart.length,
                separatorBuilder: (ctx, i) => const Divider(height: 1, color: Color(0xFFE4E4FB)),
                itemBuilder: (ctx, i) {
                  final idx = cart.length - 1 - i;
                  final e = cart[idx];
                  final label = e.grouptype != null ? patternLabel(e.key) : e.key;
                  final expanded = expandedEntries.contains(e);
                  return Container(
                    color: i % 2 == 0 ? const Color(0xFFF4F3FF) : Colors.white,
                    child: Column(children: [
                      SizedBox(
                        height: 54,
                        child: Row(children: [
                          Expanded(flex: 1, child: Center(child: Text('${idx + 1}', style: const TextStyle(fontSize: 17)))),
                          Expanded(
                            flex: 3,
                            child: Center(
                              child: Row(children: [
                                if (e.numbers.length > 1) ...[
                                  InkWell(
                                    onTap: () => _ungroupEntry(e),
                                    child: const Padding(
                                      padding: EdgeInsets.all(4),
                                      child: Icon(Icons.link, size: 18, color: Color(0xFF4F46E5)),
                                    ),
                                  ),
                                  const SizedBox(width: 3),
                                ],
                                Flexible(
                                  child: GestureDetector(
                                    onTap: e.numbers.length > 1 ? () => _toggleExpand(e) : null,
                                    child: Text(e.numbers.length > 1 ? '$label (${e.numbers.length})' : label,
                                        overflow: TextOverflow.ellipsis, maxLines: 1, style: numberStyle(fontSize: 20)),
                                  ),
                                ),
                              ]),
                            ),
                          ),
                          Expanded(
                            flex: 3,
                            child: Center(
                              child: Text(session.money(e.unit.round()), style: numberStyle(fontSize: 20)),
                            ),
                          ),
                          Expanded(
                            flex: 3,
                            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                              InkWell(onTap: () => _editEntry(e), child: const Icon(Icons.edit_note_outlined, color: Color(0xFF4F46E5), size: 28)),
                              const SizedBox(width: 8),
                              InkWell(onTap: () => _deleteEntry(e), child: const Icon(Icons.delete, color: Colors.red, size: 28)),
                            ]),
                          ),
                        ]),
                      ),
                      if (expanded)
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                          child: Wrap(spacing: 6, runSpacing: 6, children: [
                            for (final num in e.numbers)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(color: const Color(0xFFE4E4FB), borderRadius: BorderRadius.circular(20)),
                                child: Text(num, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, fontSize: 16)),
                              ),
                          ]),
                        ),
                    ]),
                  );
                },
              ),
      ),
      const Divider(height: 1, color: Color(0xFFC7C5F0)),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        color: const Color(0xFFF4F3FF),
        child: Row(children: [
          IconButton(
            icon: Icon(Icons.send, color: lastTicket != null ? const Color(0xFF4F46E5) : Colors.grey.shade400, size: 20),
            tooltip: lastTicket != null ? 'နောက်ဆုံး Slip #${lastTicket!['slip_no']} ပို့ရန်' : 'ပို့ရန် Slip မရှိသေးပါ',
            onPressed: lastTicket == null ? null : _sendLastSlip,
            visualDensity: VisualDensity.compact,
          ),
          IconButton(
            icon: Icon(Icons.print, color: lastTicket != null ? const Color(0xFF1E1B4B) : Colors.grey.shade400, size: 20),
            tooltip: lastTicket != null ? 'နောက်ဆုံး Slip #${lastTicket!['slip_no']} ပရင့်ထုတ်ရန်' : 'ပရင့်ထုတ်ရန် Slip မရှိသေးပါ',
            onPressed: lastTicket == null ? null : _printLastSlip,
            visualDensity: VisualDensity.compact,
          ),
          IconButton(
            icon: const Icon(Icons.grid_on, color: Colors.red, size: 20),
            tooltip: 'ဘရိတ်ပြည့်နေသော ဂဏန်းများ',
            onPressed: _showFullNumbers,
            visualDensity: VisualDensity.compact,
          ),
          const Spacer(),
          Text('ယူနစ် ${session.money(grandUnits)}', style: const TextStyle(fontSize: 12.5, color: Color(0xFF1E1B4B), fontWeight: FontWeight.w600)),
        ]),
      ),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xFFEEF0FF), Color(0xFFE4E4FB)])),
        child: Row(children: [
          const Text('စုစုပေါင်း', style: TextStyle(color: Color(0xFF1E1B4B), fontWeight: FontWeight.w700)),
          const Spacer(),
          Text('${session.money(grandTotal)} Ks', style: const TextStyle(color: Color(0xFF1E1B4B), fontWeight: FontWeight.w900, fontSize: 16)),
          if (session.canSaveOver || manages(term) || asInt(customer?['sale_over']) == 1) ...[
            const SizedBox(width: 8),
            InkWell(
              onTap: () => setState(() => saveOver = !saveOver),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 22,
                  height: 22,
                  child: Checkbox(value: saveOver, onChanged: (v) => setState(() => saveOver = v ?? false), visualDensity: VisualDensity.compact, materialTapTargetSize: MaterialTapTargetSize.shrinkWrap),
                ),
                const SizedBox(width: 4),
                const Text('အကျွံများသိမ်း', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: Color(0xFF1E1B4B))),
              ]),
            ),
          ],
          const SizedBox(width: 8),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: Dash.ink, shape: const StadiumBorder()),
            onPressed: (busy || cart.isEmpty || timeExpired) ? null : submit,
            icon: busy
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.save),
            label: const Text('ထိုးမည်'),
          ),
        ]),
      ),
    ]),
    );
  }
}
