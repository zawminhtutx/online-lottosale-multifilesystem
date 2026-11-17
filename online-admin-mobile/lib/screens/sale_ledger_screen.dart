import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';

// Full-screen sale ledger: ဂဏန်း / ယူနစ် / ကျွံ, opened from a button on the Sale screen
// so the cart can use the full width. Cart units (not yet saved) are added on top of the
// server exposure, same as the old side list.
class SaleLedgerScreen extends StatefulWidget {
  final int termId;
  final int betTypeId;
  final int digits;
  final int breakCap;
  final Map<String, int> cartUnits;

  const SaleLedgerScreen({
    super.key,
    required this.termId,
    required this.betTypeId,
    required this.digits,
    required this.breakCap,
    required this.cartUnits,
  });

  @override
  State<SaleLedgerScreen> createState() => _SaleLedgerScreenState();
}

class _SaleLedgerScreenState extends State<SaleLedgerScreen> {
  final Map<String, int> ledgerUnits = {};
  final Map<String, int> purchased = {};
  String ledgerSort = 'num';
  String? ledgerFocus;
  final ledgerScroll = ScrollController();
  final findCtrl = TextEditingController();
  void Function()? _stopLive;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    _stopLive = Live.instance.listen('tickets', (m) {
      if (m['reconnected'] == true || m['term_id'] == null || asInt(m['term_id']) == widget.termId) {
        _load();
      }
    });
  }

  @override
  void dispose() {
    _stopLive?.call();
    ledgerScroll.dispose();
    findCtrl.dispose();
    super.dispose();
  }

  List<String> _nums() => [for (var i = 0; i < _pow10(widget.digits); i++) i.toString().padLeft(widget.digits, '0')];

  int _pow10(int n) {
    var v = 1;
    for (var i = 0; i < n; i++) {
      v *= 10;
    }
    return v;
  }

  int _soldUnits(String num) => (ledgerUnits[num] ?? 0) + (widget.cartUnits[num] ?? 0);

  int _extraUnits(String num) {
    final cap = widget.breakCap;
    if (cap <= 0) return 0;
    final over = _soldUnits(num) - cap - (purchased[num] ?? 0);
    return over > 0 ? over : 0;
  }

  List<String> _orderedNums() {
    final nums = _nums();
    if (ledgerSort != 'units') return nums;
    nums.sort((a, b) {
      final u = _soldUnits(b) - _soldUnits(a);
      if (u != 0) return u;
      return a.compareTo(b);
    });
    return nums;
  }

  ({int all, int buy, int extra, int ledger, int? pct}) _totals() {
    var all = 0, extra = 0;
    for (final n in _nums()) {
      all += _soldUnits(n);
      extra += _extraUnits(n);
    }
    final buy = purchased.values.fold<int>(0, (a, v) => a + v);
    final ledger = all - buy - extra;
    final cap = widget.breakCap;
    return (all: all, buy: buy, extra: extra, ledger: ledger, pct: cap > 0 ? (ledger / cap).round() : null);
  }

  Future<void> _load() async {
    final d = widget.digits;
    final typeId = widget.betTypeId;
    try {
      final rows = (await Api.instance.get('/terms/${widget.termId}/exposure?bet_type_id=$typeId') as List)
          .map((r) => Map<String, dynamic>.from(r as Map));
      ledgerUnits
        ..clear()
        ..addEntries(rows.map((r) => MapEntry('${r['number']}'.padLeft(d, '0'), asInt(r['units']))));
    } catch (_) {}
    if (!mounted) return;
    purchased.clear();
    if (context.read<Session>().isAdmin) {
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
    if (mounted) setState(() => loading = false);
  }

  void _onFind(String raw) {
    final typed = raw.replaceAll(RegExp(r'\D'), '');
    if (typed != raw) findCtrl.value = TextEditingValue(text: typed, selection: TextSelection.collapsed(offset: typed.length));
    if (typed.isEmpty || typed.length > widget.digits) {
      setState(() => ledgerFocus = null);
      return;
    }
    String? target;
    if (typed.length == widget.digits) {
      target = typed.padLeft(widget.digits, '0');
    } else {
      for (final n in _orderedNums()) {
        if (n.startsWith(typed)) {
          target = n;
          break;
        }
      }
    }
    setState(() => ledgerFocus = target);
    if (target == null || !ledgerScroll.hasClients) return;
    final i = _orderedNums().indexOf(target);
    if (i < 0) return;
    final top = i * 32.0 - 80;
    ledgerScroll.animateTo(top.clamp(0, ledgerScroll.position.maxScrollExtent), duration: const Duration(milliseconds: 160), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final nums = _orderedNums();
    final tot = _totals();
    final pct = tot.pct == null ? '—' : '${session.money(tot.pct)}%';
    return DashScaffold(
      title: const Text('Ledger'),
      body: loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : Column(children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: Container(
                    clipBehavior: Clip.antiAlias,
                    decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
                    child: Column(children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
                        child: TextField(
                          controller: findCtrl,
                          keyboardType: TextInputType.number,
                          maxLength: widget.digits,
                          autofocus: true,
                          onChanged: _onFind,
                          decoration: const InputDecoration(
                            counterText: '',
                            hintText: 'ဂဏန်း ရှာရန်',
                            isDense: true,
                            prefixIcon: Icon(Icons.search, size: 20),
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      Container(
                        height: 40,
                        color: const Color(0xFFE4E4FB),
                        child: Row(children: [
                          Expanded(
                            child: InkWell(
                              onTap: () => setState(() => ledgerSort = 'num'),
                              child: Center(
                                child: Text('ဂဏန်း',
                                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: ledgerSort == 'num' ? const Color(0xFF4F46E5) : const Color(0xFF1E1B4B))),
                              ),
                            ),
                          ),
                          Expanded(
                            child: InkWell(
                              onTap: () => setState(() => ledgerSort = 'units'),
                              child: Center(
                                child: Text('ယူနစ်',
                                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: ledgerSort == 'units' ? const Color(0xFF4F46E5) : const Color(0xFF1E1B4B))),
                              ),
                            ),
                          ),
                          const Expanded(child: Center(child: Text('ကျွံ', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: Color(0xFFB91C1C))))),
                        ]),
                      ),
                      Expanded(
                        child: ListView.builder(
                          controller: ledgerScroll,
                          itemCount: nums.length,
                          itemExtent: 32,
                          itemBuilder: (ctx, i) {
                            final num = nums[i];
                            final u = _soldUnits(num);
                            final extra = _extraUnits(num);
                            final hit = num == ledgerFocus;
                            return ColoredBox(
                              color: hit
                                  ? const Color(0xFFFDE68A)
                                  : extra > 0
                                      ? const Color(0xFFFEE2E2)
                                      : u > 0
                                          ? const Color(0xFFECFDF5)
                                          : Colors.white,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 12),
                                child: Row(children: [
                                  Expanded(child: Text(num, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w800, fontSize: 16))),
                                  Expanded(child: Text(session.money(u), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                                  Expanded(child: Text(session.money(extra), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Color(0xFFDC2626)))),
                                ]),
                              ),
                            );
                          },
                        ),
                      ),
                    ]),
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 14),
                color: const Color(0xFF0F172A),
                child: Text(
                  'All ${session.money(tot.all)}  ·  Buy ${session.money(tot.buy)}  ·  Extra ${session.money(tot.extra)}  ·  Ledger ${session.money(tot.ledger)} ($pct)',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF93C5FD), fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
            ]),
    );
  }
}
