import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/pattern_parser.dart';
import '../services/report_text.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import '../widgets/person_filter.dart';
import 'account_report_screen.dart';
import 'bet_screen.dart';
import 'slips_screen.dart';
import 'terms_screen.dart';

// One term: status actions (open / close / reopen) and edit in the app bar menu, and
// tabs — Live Ledger, ဘရိတ် (unit break), ဂဏန်းတစ်ကွက် ယူနစ် (per user), ဟော့ဂဏန်း (hot %), ပေါက်ဂဏန်း (results +
// settle), စလစ်, စာရင်း.
class TermDetailScreen extends StatefulWidget {
  final int termId;
  /// When true the screen skips the tab bar and shows only the purchase (အဝယ်) content.
  final bool purchaseMode;
  const TermDetailScreen({super.key, required this.termId, this.purchaseMode = false});

  @override
  State<TermDetailScreen> createState() => _TermDetailScreenState();
}

class _TermDetailScreenState extends State<TermDetailScreen> {
  Map<String, dynamic>? term;
  List<Map<String, dynamic>> betTypes = [];
  String? error;
  void Function()? _stopLive;

  @override
  void initState() {
    super.initState();
    _load();
    _stopLive = Live.instance.listen('terms', (_) => _load());
  }

  @override
  void dispose() {
    _stopLive?.call();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final session = context.read<Session>();
      final results = await Future.wait([
        Api.instance.get('/terms/${widget.termId}'),
        Api.instance.get('/meta'),
        // The admin can turn a master's / an agent's Live Ledger on or off at any time.
        if (session.isDownline) Api.instance.get('/auth/me'),
      ]);
      if (session.isDownline) session.setUser(Map<String, dynamic>.from(results[2] as Map));
      final t = Map<String, dynamic>.from(results[0] as Map);
      final digits = t['game'] == '3D' ? 3 : 2;
      final types = ((results[1] as Map)['bet_types'] as List).map((b) => Map<String, dynamic>.from(b as Map));
      if (!mounted) return;
      setState(() {
        term = t;
        betTypes = types.where((b) => t['game'] == '2D3D' || asInt(b['digits']) == digits).toList();
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  bool get locked => ['drawn', 'settled', 'cancelled'].contains(term?['status']);

  Future<void> _setStatus(String status, String label, {bool danger = false}) async {
    if (!await confirm(context, '$label?', message: '${term!['description']}', ok: label, danger: danger)) return;
    try {
      await Api.instance.patch('/terms/${widget.termId}', {'status': status});
      if (mounted) snack(context, label);
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => TermFormScreen(term: term)));
    if (saved != null) _load();
  }

  // Any term, even a settled one, can move to another folder (ဖိုင်).
  Future<void> _moveFolder() async {
    try {
      final r = await pickFolder(context, term!['folder_id']);
      if (!r.picked || !mounted) return;
      await Api.instance.patch('/terms/${widget.termId}', {'folder_id': r.id});
      if (mounted) snack(context, 'ဖိုင် ပြောင်းပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  // A term without sales (slips) is deleted here at once. One with sales needs an Excel + PDF
  // backup first, which the web dashboard makes (🗑 on the term there).
  Future<void> _delete() async {
    final slips = asInt(term!['slip_count']);
    if (slips > 0) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('အရောင်းစာရင်း ရှိပါသည်'),
          content: Text('${term!['description']} မှာ စလစ် $slips ခု ရှိပါသည်။\n\n'
              'ဖျက်ရန် Excel + PDF backup အရင်ယူရပါမည် — Web admin ရဲ့ အပါတ်စဥ် စာမျက်နှာမှ 🗑 ဖြင့် ဖျက်ပါ။'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      return;
    }
    final ok = await confirm(context, 'အပါတ်စဥ် ဖျက်မလား?',
        message: '${term!['description']}\n\nစလစ် မရှိပါ။ ပြန်ယူ၍ မရပါ။',
        ok: 'ဖျက်မည်',
        danger: true);
    if (!ok || !mounted) return;
    try {
      final r = await Api.instance.delete('/terms/${widget.termId}') as Map;
      if (!mounted) return;
      final refunded = asInt(r['refunded']);
      snack(context, refunded > 0 ? 'ဖျက်ပြီးပါပြီ · ${context.read<Session>().money(refunded)} ကျပ် ပြန်အမ်းပြီး' : 'အပါတ်စဥ် ဖျက်ပြီးပါပြီ');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = term;
    if (t == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('အပါတ်စဥ်')),
        body: error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()),
      );
    }
    final status = '${t['status']}';
    final session = context.read<Session>();
    // Book tools follow can_manage: admin on every term, a master on its own files. A master with
    // hot_edit may still edit hot numbers on a shared term it does not own.
    final book = manages(t);
    final hotEdit = book || (session.isMaster && asInt(session.user?['hot_edit']) == 1);

    // Purchase-mode: skip the full tab UI and show only the purchase (အဝယ်) content.
    if (widget.purchaseMode && book) {
      return Scaffold(
        appBar: AppBar(
          title: Text('အဝယ် — ${t['description']}', overflow: TextOverflow.ellipsis),
          actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
        ),
        body: ContentWidth(child: _PurchaseTab(term: t, betTypes: betTypes)),
      );
    }

    final tabs = <(String, Widget)>[
      ('Live Ledger', LedgerTab(term: t, betTypes: betTypes)),
      // Setting tabs keep a readable width on tablets; the ledger, slips and report use it all.
      if (book) ('ဘရိတ်', ContentWidth(child: _BreakTab(term: t, betTypes: betTypes, locked: locked, onSaved: _load))),
      // Settings: name, folder, unit price, open / close / draw times (like the web dashboard's tab).
      if (book)
        ('Settings', TermFormScreen(key: ValueKey('settings-${t['id']}-$locked'), term: t, embedded: true, locked: locked, onSaved: (_) => _load())),
      // Max Unit per user is the admin's and the master's (the server allows those two).
      if (!session.isAgent) ('ထိုးသား Max Unit', ContentWidth(child: _UserLimitsTab(term: t, betTypes: betTypes, locked: locked))),
      if (book) ('ပိတ်ဂဏန်းများ', ContentWidth(child: _ClosedTab(term: t, betTypes: betTypes, locked: locked, onSaved: _load))),
      ('ဟော့ဂဏန်းများ', ContentWidth(child: _HotTab(term: t, betTypes: betTypes, locked: locked || !hotEdit, onSaved: _load))),
      // 'အဝယ်' moved to the dashboard button (PurchaseTermsScreen → purchaseMode:true).
      if (book) ('ပေါက်သီး', ContentWidth(child: _ResultsTab(term: t, onChanged: _load))),
      // 'စလစ်များ' and 'စာရင်းကြည့်' only shown to admin; master/agent use the dashboard tiles.
      if (session.isAdmin) ('စလစ်များ', SlipList(termId: asInt(t['id']), embedded: true)),
      if (session.isAdmin) ('စာရင်းကြည့်', _SummaryTab(termId: asInt(t['id']), folderId: t['folder_id'] == null ? null : asInt(t['folder_id']), title: '${t['description']}')),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          titleSpacing: 0,
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text('${t['description']}', overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
              const SizedBox(width: 6),
              termBadge(status),
            ]),
            Text('#${t['id']} · ${t['game']} · ${session.money(asInt(t['unit_price']))} Ks · ပိတ် ${timeOnly(t['close_at'])}',
                style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
          ]),
          actions: [
            if (status == 'open')
              IconButton(
                icon: const Icon(Icons.point_of_sale),
                tooltip: 'အရောင်း',
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BetScreen(termId: asInt(t['id'])))),
              ),
            // Auto terms start as drafts: Active opens one, so users can see and bet on it.
            if (book && status == 'draft') TextButton(onPressed: () => _setStatus('open', 'Active လုပ်'), child: const Text('▶ Active')),
            if (book && status == 'open') TextButton(onPressed: () => _setStatus('closed', 'ထိုးကြေးပိတ်', danger: true), child: const Text('ပိတ်မည်')),
            if (book && status == 'closed') TextButton(onPressed: () => _setStatus('open', 'ပြန်ဖွင့်'), child: const Text('ပြန်ဖွင့်')),
            if (!book) IconButton(icon: const Icon(Icons.refresh), tooltip: 'Refresh', onPressed: _load),
            if (book)
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'edit') _edit();
                  if (v == 'folder') _moveFolder();
                  if (v == 'refresh') _load();
                  if (v == 'delete') _delete();
                  if (v == 'unactive') _setStatus('draft', 'Unactive');
                },
                itemBuilder: (_) => [
                  if (!locked) const PopupMenuItem(value: 'edit', child: Text('ပြင်ရန်')),
                  const PopupMenuItem(value: 'folder', child: Text('ဖိုင်ပြောင်းရန်')),
                  // ⏸ Unactive: hide an Active term from users again (back to "Active မလုပ်ရသေး").
                  if (status == 'open') const PopupMenuItem(value: 'unactive', child: Text('⏸ Unactive')),
                  const PopupMenuItem(value: 'refresh', child: Text('Refresh')),
                  const PopupMenuItem(value: 'delete', child: Text('အပါတ်စဥ် ဖျက်ရန်', style: TextStyle(color: Colors.red))),
                ],
              ),
          ],
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final (label, _) in tabs) Tab(text: label)],
          ),
        ),
        body: TabBarView(children: [for (final (_, tab) in tabs) tab]),
      ),
    );
  }
}

// ---------------------------------------------------------------- Live Ledger

// Every number with its units, coloured against the unit break (green / orange ≥80% / red over),
// live over WebSocket. Two views like the web dashboard (choice remembered on the phone):
//  - Table: the POS ledger sheet, 10 column pairs (Num | Unit) — column = tens (00-09 | 10-19 …).
//  - Grid: one tile per number (units, +extra over the break), sortable by number or units; the
//    tiles widen with the longest figure. Figures too long for a cell shrink instead of overflowing.
class LedgerTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  const LedgerTab({super.key, required this.term, required this.betTypes});

  @override
  State<LedgerTab> createState() => _LedgerTabState();
}

class _LedgerTabState extends State<LedgerTab> with AutomaticKeepAliveClientMixin {
  Map<String, int> units = {};
  Map<String, int> amounts = {};
  List<Map<String, dynamic>> users = [];
  final Set<int> chosen = {};
  Set<String> changed = {};
  DateTime? updated;
  bool loading = true;
  String? error;
  bool connected = Live.instance.isConnected;
  final _stops = <void Function()>[];
  static const _viewKey = 'ledger_view';
  String view = 'table'; // 'table' | 'grid'
  bool byUnits = false; // grid: sort by units (most first) instead of number

  int get digits => widget.term['game'] == '3D' ? 3 : 2;
  int get typeId => asInt(widget.betTypes.isEmpty ? 0 : widget.betTypes.first['id']);
  int get cap => asInt(((widget.term['limits'] as List?) ?? const []).cast<Map>().where((l) => asInt(l['bet_type_id']) == typeId).map((l) => l['max_units']).firstOrNull);

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      final v = p.getString(_viewKey);
      if (mounted && (v == 'table' || v == 'grid')) setState(() => view = v!);
    });
    _load();
    _stops.add(Live.instance.listen('tickets', (m) {
      if (m['reconnected'] == true || asInt(m['term_id']) == asInt(widget.term['id'])) _load();
    }));
    final sub = Live.instance.connected.stream.listen((v) {
      if (mounted) setState(() => connected = v);
    });
    _stops.add(sub.cancel);
  }

  @override
  void dispose() {
    for (final s in _stops) {
      s();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final q = chosen.isEmpty ? '' : '&user_ids=${chosen.join(',')}';
      final results = await Future.wait([
        Api.instance.get('/terms/${widget.term['id']}/exposure?bet_type_id=$typeId&live_ledger=1$q'),
        // ledger-users follows liveLedgerScope (own tree, or every tree if the master is granted).
        Api.instance.get(context.read<Session>().isDownline
            ? '/terms/${widget.term['id']}/ledger-users'
            : '/reports/summary?term_id=${widget.term['id']}&group_by=user'),
      ]);
      final rows = (results[0] as List).cast<Map>();
      final next = {for (final r in rows) '${r['number']}': asInt(r['units'])};
      if (!mounted) return;
      setState(() {
        changed = updated == null ? {} : {for (final k in {...next.keys, ...units.keys}) if (next[k] != units[k]) k};
        units = next;
        amounts = {for (final r in rows) '${r['number']}': asInt(r['amount'])};
        users = (results[1] as List).map((u) => Map<String, dynamic>.from(u as Map)).toList();
        updated = DateTime.now();
        loading = false;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _pickUsers() async {
    final picked = await showModalBottomSheet<Set<int>>(
      context: context,
      builder: (ctx) {
        final local = {...chosen};
        return StatefulBuilder(
          builder: (ctx, setSt) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                title: const Text('ကစားသူ ရွေးရန်', style: TextStyle(fontWeight: FontWeight.w800)),
                trailing: FilledButton(onPressed: () => Navigator.pop(ctx, local), child: const Text('OK')),
              ),
              CheckboxListTile(
                value: local.isEmpty,
                title: const Text('ကစားသူအားလုံး', style: TextStyle(fontWeight: FontWeight.w700)),
                onChanged: (_) => setSt(local.clear),
              ),
              Flexible(
                child: ListView(shrinkWrap: true, children: [
                  for (final u in users)
                    CheckboxListTile(
                      value: local.contains(asInt(u['id'])),
                      title: Text('${u['username']}'),
                      onChanged: (v) => setSt(() => v == true ? local.add(asInt(u['id'])) : local.remove(asInt(u['id']))),
                    ),
                ]),
              ),
            ]),
          ),
        );
      },
    );
    if (picked == null) return;
    setState(() {
      chosen
        ..clear()
        ..addAll(picked);
      updated = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (loading && error == null) return const Center(child: CircularProgressIndicator());
    if (error != null && units.isEmpty && updated == null) return ErrorView(message: error!, onRetry: _load);
    final session = context.read<Session>();
    final c = cap;
    final all = units.values.fold(0, (a, b) => a + b);
    final extra = c > 0 ? units.values.fold(0, (a, u) => a + (u > c ? u - c : 0)) : 0;
    final amount = amounts.values.fold(0, (a, b) => a + b);
    final rowsPerCol = digits == 3 ? 100 : 10;
    final names = users.where((u) => chosen.contains(asInt(u['id']))).map((u) => '${u['username']}').toList();

    // Tone of one number against the break: zero / ok (green) / near ≥80% (orange) / over (red).
    ({Color bg, Color fg, int over}) toneOf(String num) {
      final u = units[num] ?? 0;
      final over = c > 0 && u > c ? u - c : 0;
      final near = c > 0 && u >= c * .8 && u > 0;
      final Color bg = changed.contains(num)
          ? const Color(0xFFE0E7FF)
          : u == 0
              ? Colors.white
              : over > 0
                  ? const Color(0xFFFDECF1)
                  : near
                      ? const Color(0xFFFFF4E5)
                      : const Color(0xFFE7F6EC);
      final Color fg = u == 0 ? Colors.grey : over > 0 ? const Color(0xFFC01048) : near ? const Color(0xFFB54708) : const Color(0xFF067647);
      return (bg: bg, fg: fg, over: over);
    }

    // Text that might not fit its cell is scaled down instead of overflowing.
    Widget fit(String text, TextStyle style) => FittedBox(fit: BoxFit.scaleDown, child: Text(text, style: style, maxLines: 1));

    final numbers = [for (var i = 0; i < 10 * rowsPerCol; i++) i.toString().padLeft(digits, '0')];

    // Table: 10 column pairs (Num | Unit) like the POS ledger sheet / the web Table view.
    Widget table() {
      final line = Colors.grey.shade300;
      return Container(
        decoration: BoxDecoration(border: Border.all(color: line), borderRadius: BorderRadius.circular(8)),
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var r = 0; r < rowsPerCol; r++)
            IntrinsicHeight(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (var k = 0; k < 10; k++) ...[
                  Expanded(
                    flex: 10,
                    child: GestureDetector(
                      onTap: () => _showNumberBets(numbers[k * rowsPerCol + r]),
                      child: Container(
                        decoration: BoxDecoration(color: const Color(0xFFF1F5F9), border: Border(bottom: BorderSide(color: line))),
                        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 1),
                        alignment: Alignment.center,
                        child: fit(numbers[k * rowsPerCol + r], numberStyle(fontSize: digits == 3 ? 10.5 : 12)),
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 13,
                    child: GestureDetector(
                      onTap: () => _showNumberBets(numbers[k * rowsPerCol + r]),
                      child: _unitCell(numbers[k * rowsPerCol + r], toneOf, fit, line, session, c),
                    ),
                  ),
                ],
              ]),
            ),
        ]),
      );
    }

    // Grid: one tile per number; as many columns as fit the width at the longest figure's size.
    Widget grid() {
      final order = byUnits
          ? ([...numbers]..sort((a, b) {
              final d = (units[b] ?? 0) - (units[a] ?? 0);
              return d != 0 ? d : a.compareTo(b);
            }))
          : numbers;
      final longest = units.isEmpty ? 1 : units.values.map((u) => session.money(u).length).reduce((a, b) => a > b ? a : b);
      final tileW = (longest * 8.5 + 18).clamp(50.0, 120.0);
      return LayoutBuilder(builder: (context, box) {
        final cols = (box.maxWidth / tileW).floor().clamp(4, 10);
        final w = box.maxWidth / cols;
        return Wrap(children: [
          for (final num in order)
            SizedBox(width: w, child: GestureDetector(onTap: () => _showNumberBets(num), child: _gridTile(num, toneOf(num), fit, session, c))),
        ]);
      });
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(10), children: [
        Row(children: [
          StatusChip(connected ? '● Live' : 'ပြန်ချိတ်နေသည်…', connected ? const Color(0xFF059669) : const Color(0xFFD97706)),
          const SizedBox(width: 8),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _pickUsers,
                icon: const Icon(Icons.person, size: 18),
                label: Text(names.isEmpty ? 'ကစားသူ: အားလုံး' : names.length <= 2 ? names.join(', ') : 'ကစားသူ ${names.length} ဦး',
                    overflow: TextOverflow.ellipsis),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        // Same figures as the web Live Ledger. Total = all units up to the break (extra left out);
        // Ratio = Total ÷ unit break, rounded, as %.
        _StatGrid(stats: [
          ('All Total', session.money(all), extra > 0 ? const Color(0xFFC01048) : null),
          ('Total', session.money(all - extra), null),
          ('Unit Break', c > 0 ? session.money(c) : '—', null),
          ('Ratio %', c > 0 ? '${session.money(((all - extra) / c).round())}%' : '—', null),
          ('Amount (Ks)', session.money(amount), null),
          ('Numbers Bet', '${units.length} / ${10 * rowsPerCol}', null),
          ('Updated', updated == null ? '—' : DateFormat('h:mm:ss a').format(updated!), null),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          SegmentedButton<String>(
            showSelectedIcon: false,
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [
              ButtonSegment(value: 'table', icon: Icon(Icons.table_rows_outlined, size: 18), label: Text('Table')),
              ButtonSegment(value: 'grid', icon: Icon(Icons.grid_view, size: 18), label: Text('Grid')),
            ],
            selected: {view},
            onSelectionChanged: (v) {
              setState(() => view = v.first);
              SharedPreferences.getInstance().then((p) => p.setString(_viewKey, view));
            },
          ),
          const Spacer(),
          if (view == 'grid')
            TextButton.icon(
              onPressed: () => setState(() => byUnits = !byUnits),
              icon: const Icon(Icons.sort, size: 18),
              label: Text(byUnits ? 'ယူနစ်အလိုက်' : 'ဂဏန်းအလိုက်'),
            ),
        ]),
        const SizedBox(height: 6),
        view == 'table' ? table() : grid(),
      ]),
    );
  }

  // Tap a number: who bet on it (within the chosen users) — each user's units, amount and slips.
  Future<void> _showNumberBets(String num) async {
    final session = context.read<Session>();
    List<Map<String, dynamic>> rows;
    try {
      final q = chosen.isEmpty ? '' : '&user_ids=${chosen.join(',')}';
      rows = ((await Api.instance.get('/terms/${widget.term['id']}/number-bets?bet_type_id=$typeId&number=$num$q')) as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .toList();
    } catch (e) {
      if (mounted) errorSnack(context, e);
      return;
    }
    if (!mounted) return;
    final c = cap;
    final sum = rows.fold<int>(0, (a, r) => a + asInt(r['units']));
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * .75),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 0),
              child: Row(children: [
                Text('ဂဏန်း $num', style: numberStyle(fontSize: 20)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('${session.money(sum)} ယူနစ်${c > 0 ? '  ·  ဘရိတ် ${session.money(c)}' : ''}${c > 0 && sum > c ? '  ·  ကျွံ ${session.money(sum - c)}' : ''}',
                      style: TextStyle(color: c > 0 && sum > c ? const Color(0xFFC01048) : Colors.grey[700], fontWeight: FontWeight.w600)),
                ),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ]),
            ),
            const Divider(height: 1),
            if (rows.isEmpty)
              const Padding(padding: EdgeInsets.all(28), child: Center(child: Text('ဤဂဏန်းကို ထိုးထားသူ မရှိပါ')))
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: rows.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final r = rows[i];
                    return ListTile(
                      dense: true,
                      title: Text('${r['username']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Text([
                        if ('${r['name'] ?? ''}'.isNotEmpty && r['name'] != r['username']) '${r['name']}',
                        if (r['agent_username'] != null) 'Agent ${r['agent_username']}',
                        'စလစ် ${r['slips']}',
                      ].join('  ·  ')),
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text('${session.money(asInt(r['units']))} ယူနစ်', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                        Text('${session.money(asInt(r['amount']))} Ks', style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                      ]),
                    );
                  },
                ),
              ),
          ]),
        ),
      ),
    );
  }

  // Table view's Unit cell: the units (capped at the break) and "+extra" below when over it.
  Widget _unitCell(String num, ({Color bg, Color fg, int over}) Function(String) toneOf, Widget Function(String, TextStyle) fit,
      Color line, Session session, int c) {
    final u = units[num] ?? 0;
    final tone = toneOf(num);
    return Container(
      decoration: BoxDecoration(color: tone.bg, border: Border(right: BorderSide(color: line), bottom: BorderSide(color: line))),
      padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 1),
      alignment: Alignment.center,
      child: u == 0
          ? const SizedBox.shrink()
          : Column(mainAxisSize: MainAxisSize.min, children: [
              fit(session.money(tone.over > 0 ? c : u), numberStyle(fontSize: 11.5, color: tone.fg)),
              if (tone.over > 0) fit('+${session.money(tone.over)}', numberStyle(fontSize: 9.5, color: tone.fg)),
            ]),
    );
  }

  // Grid view's tile: number, units (capped at the break) and "+extra" when over it.
  Widget _gridTile(String num, ({Color bg, Color fg, int over}) tone, Widget Function(String, TextStyle) fit, Session session, int c) {
    final u = units[num] ?? 0;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 600),
      margin: const EdgeInsets.all(1.5),
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 3),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: u == 0 ? Colors.grey.shade200 : tone.fg.withValues(alpha: .5)),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        fit(num, numberStyle(fontSize: digits == 3 ? 11 : 13)),
        fit(u == 0 ? '-' : session.money(tone.over > 0 ? c : u), numberStyle(fontSize: 12, color: tone.fg)),
        if (tone.over > 0) fit('+${session.money(tone.over)}', numberStyle(fontSize: 10, color: tone.fg)),
      ]),
    );
  }
}

// The Live Ledger's figures as equal boxes: all 7 in one row on a wide screen, 4 + 3 on a phone.
// A value too long for its box shrinks instead of overflowing.
class _StatGrid extends StatelessWidget {
  final List<(String, String, Color?)> stats;
  const _StatGrid({required this.stats});

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final cols = box.maxWidth >= 700 ? stats.length : 4;
        const gap = 6.0;
        final w = (box.maxWidth - gap * (cols - 1)) / cols;
        return Wrap(spacing: gap, runSpacing: gap, children: [
          for (final (label, value, color) in stats)
            Container(
              width: w,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.grey.shade200)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1, style: TextStyle(fontSize: 11, color: Colors.grey[600]))),
                FittedBox(fit: BoxFit.scaleDown, child: Text(value, maxLines: 1, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: color))),
              ]),
            ),
        ]);
      });
}

// ---------------------------------------------------------------- Unit break

class _BreakTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  final bool locked;
  final VoidCallback onSaved;
  const _BreakTab({required this.term, required this.betTypes, required this.locked, required this.onSaved});

  @override
  State<_BreakTab> createState() => _BreakTabState();
}

class _BreakTabState extends State<_BreakTab> {
  final ctrls = <int, TextEditingController>{};
  bool busy = false;

  @override
  void initState() {
    super.initState();
    final limits = {for (final l in (widget.term['limits'] as List? ?? const []).cast<Map>()) asInt(l['bet_type_id']): asInt(l['max_units'])};
    for (final bt in widget.betTypes) {
      ctrls[asInt(bt['id'])] = TextEditingController(text: '${limits[asInt(bt['id'])] ?? 0}');
    }
  }

  Future<void> _save() async {
    setState(() => busy = true);
    try {
      final rows = [
        for (final e in ctrls.entries)
          if ((int.tryParse(e.value.text.trim()) ?? 0) > 0) {'bet_type_id': e.key, 'max_units': int.parse(e.value.text.trim())},
      ];
      await Api.instance.put('/terms/${widget.term['id']}/limits', rows);
      if (mounted) snack(context, 'ဘရိတ် သိမ်းပြီးပါပြီ');
      widget.onSaved();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final price = asInt(widget.term['unit_price']);
    return ListView(padding: const EdgeInsets.all(12), children: [
      SectionCard(title: 'ဘရိတ် (Unit break)', children: [
        Text('ဂဏန်းတစ်ကွက်ကို စလစ်အားလုံးပေါင်း အများဆုံး ယူနစ်။ 0 = ကန့်သတ်ချက်မရှိ။', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
        const SizedBox(height: 12),
        for (final bt in widget.betTypes)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: StatefulBuilder(builder: (ctx, setSt) {
              final c = ctrls[asInt(bt['id'])]!;
              final v = int.tryParse(c.text) ?? 0;
              return TextField(
                controller: c,
                enabled: !widget.locked,
                keyboardType: TextInputType.number,
                onChanged: (_) => setSt(() {}),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                decoration: InputDecoration(
                  labelText: '${bt['description']} — ဂဏန်းတစ်ကွက် အများဆုံး ယူနစ်',
                  helperText: v > 0 ? 'အများဆုံး ${session.money(v * price)} ကျပ်' : 'ကန့်သတ်ချက် မရှိ',
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              );
            }),
          ),
        FilledButton.icon(
          onPressed: widget.locked || busy ? null : _save,
          icon: const Icon(Icons.save),
          label: const Text('သိမ်းမည်'),
        ),
      ]),
    ]);
  }
}

// ---------------------------------------------------------------- Closed numbers

// ပိတ်ဂဏန်းများ — numbers nobody may bet in this term (the admin's own list, saved), plus the
// numbers whose break is full, shown automatically (red, live, read-only: they open again by
// themselves when a slip is cancelled or the break is raised). ADD CLOSE takes numbers or sale
// patterns (12R, 2*, *2 …) like ADD HOT.
class _ClosedTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  final bool locked;
  final VoidCallback onSaved;
  const _ClosedTab({required this.term, required this.betTypes, required this.locked, required this.onSaved});

  @override
  State<_ClosedTab> createState() => _ClosedTabState();
}

class _ClosedTabState extends State<_ClosedTab> {
  final ctrls = <int, TextEditingController>{};
  Map<int, List<String>> full = {};
  final _stops = <void Function()>[];
  bool busy = false;

  @override
  void initState() {
    super.initState();
    final closed = <int, List<String>>{};
    for (final b in (widget.term['blocked'] as List? ?? const []).cast<Map>()) {
      closed.putIfAbsent(asInt(b['bet_type_id']), () => []).add('${b['number']}');
    }
    for (final bt in widget.betTypes) {
      ctrls[asInt(bt['id'])] = TextEditingController(text: ((closed[asInt(bt['id'])] ?? [])..sort()).join(' '));
    }
    _loadFull();
    // A slip placed / cancelled in this term, or a break change, refreshes the automatic list.
    _stops.add(Live.instance.listen('tickets', (m) {
      if (m['reconnected'] == true || asInt(m['term_id']) == asInt(widget.term['id'])) _loadFull();
    }));
    _stops.add(Live.instance.listen('terms', (_) => _loadFull()));
  }

  @override
  void dispose() {
    for (final s in _stops) {
      s();
    }
    for (final c in ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadFull() async {
    try {
      final rows = (await Api.instance.get('/terms/${widget.term['id']}/full-numbers') as List).cast<Map>();
      final next = <int, List<String>>{};
      for (final r in rows) {
        next.putIfAbsent(asInt(r['bet_type_id']), () => []).add('${r['number']}');
      }
      if (mounted) setState(() => full = next);
    } catch (_) {/* the list just stays as it was */}
  }

  // ADD CLOSE: numbers / patterns typed in a dialog are added to the box (Save stores them).
  Future<void> _addClose(Map<String, dynamic> bt) async {
    final digits = asInt(bt['digits']);
    final input = TextEditingController();
    String? error;
    final added = await showDialog<List<String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('ADD CLOSE — ${bt['description']}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: input,
              autofocus: true,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: 'ဂဏန်း / ပုံစံ',
                hintText: digits == 2 ? '12 12R 2* *2' : '123 123R 12* *12 1*2',
                helperText: 'ဂဏန်း သို့မဟုတ် ပုံစံ (12R, 2*, *2 …) — space / ကော်မာဖြင့် ခြားပါ',
                border: const OutlineInputBorder(),
              ),
            ),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: Colors.red))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(
              onPressed: () {
                final typed = <String>[];
                for (final entry in input.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty)) {
                  final parsed = parseEntry(entry.toUpperCase(), digits);
                  if (!parsed.ok) return setSt(() => error = '$entry: ${parsed.error}');
                  for (final n in parsed.numbers) {
                    if (!typed.contains(n)) typed.add(n);
                  }
                }
                if (typed.isEmpty) return setSt(() => error = 'ဂဏန်း ထည့်ပါ');
                Navigator.pop(ctx, typed);
              },
              child: const Text('ထည့်မည်'),
            ),
          ],
        ),
      ),
    );
    if (added == null || !mounted) return;
    final box = ctrls[asInt(bt['id'])]!;
    final current = box.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty).toList();
    final fresh = added.where((n) => !current.contains(n)).toList();
    setState(() => box.text = [...current, ...fresh].join(' '));
    snack(context, 'ပိတ်ဂဏန်း ${fresh.length} လုံး ထည့်ပြီး — သိမ်းရန် "သိမ်းမည်" နှိပ်ပါ');
  }

  Future<void> _save() async {
    final numbers = <Map<String, dynamic>>[];
    for (final bt in widget.betTypes) {
      final digits = asInt(bt['digits']);
      for (final n in ctrls[asInt(bt['id'])]!.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty).toSet()) {
        if (!RegExp('^[0-9]{$digits}\$').hasMatch(n)) {
          errorSnack(context, '${bt['description']}: "$n" — $digits လုံး ဖြစ်ရပါမည်');
          return;
        }
        numbers.add({'bet_type_id': asInt(bt['id']), 'number': n});
      }
    }
    setState(() => busy = true);
    try {
      await Api.instance.put('/terms/${widget.term['id']}/blocked', numbers);
      if (mounted) snack(context, 'ပိတ်ဂဏန်း ${numbers.length} လုံး သိမ်းပြီးပါပြီ');
      widget.onSaved();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(12), children: [
      SectionCard(title: 'ပိတ်ဂဏန်းများ', children: [
        Text('ဤအပါတ်စဥ်တွင် မည်သူမျှ မထိုးနိုင်သော ဂဏန်းများ။', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
        const SizedBox(height: 12),
        for (final bt in widget.betTypes) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: widget.locked ? null : () => _addClose(bt),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('ADD CLOSE'),
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: ctrls[asInt(bt['id'])],
            enabled: !widget.locked,
            keyboardType: TextInputType.number,
            minLines: 2,
            maxLines: 5,
            decoration: InputDecoration(
              labelText: '${bt['description']} — ပိတ်ဂဏန်းများ',
              hintText: asInt(bt['digits']) == 2 ? 'ဥပမာ 00 11 99' : 'ဥပမာ 123 456',
              helperText: 'space သို့မဟုတ် ကော်မာဖြင့် ခြားပါ',
              border: const OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 8),
          // Break full (auto): read-only, live.
          Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text('ဘရိတ်ပြည့် (auto): ', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
            if ((full[asInt(bt['id'])] ?? const []).isEmpty) Text('—', style: TextStyle(color: Colors.grey[600])),
            for (final n in full[asInt(bt['id'])] ?? const <String>[])
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: const Color(0xFFDC2626), borderRadius: BorderRadius.circular(6)),
                child: Text(n, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
              ),
          ]),
          const SizedBox(height: 14),
        ],
        FilledButton.icon(
          onPressed: widget.locked || busy ? null : _save,
          icon: const Icon(Icons.save),
          label: const Text('သိမ်းမည်'),
        ),
      ]),
    ]);
  }
}

// ---------------------------------------------------------------- Hot numbers

// Hot numbers stay open, but on each one a user may bet at most their hot % of their own total bets
// in this term (all their slips, before discount). Listed users get their own %, everyone else the
// default %. 0% = closed.
class _HotTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  final bool locked;
  final VoidCallback onSaved;
  const _HotTab({required this.term, required this.betTypes, required this.locked, required this.onSaved});

  @override
  State<_HotTab> createState() => _HotTabState();
}

class _HotTabState extends State<_HotTab> {
  late final TextEditingController percent;
  final ctrls = <int, TextEditingController>{};
  // Every user is listed at the default %; own[userId] holds those given their own % (typed, or
  // saved earlier). Users not in own follow the default, also when it changes.
  final own = <int, int>{};
  List<Map<String, dynamic>> users = [];
  bool busy = false;

  @override
  void initState() {
    super.initState();
    percent = TextEditingController(text: '${widget.term['hot_percent'] ?? 10}');
    for (final r in (widget.term['hot_users'] as List? ?? const []).cast<Map>()) {
      own[asInt(r['user_id'])] = asInt(r['percent']);
    }
    percent.addListener(() => setState(() {})); // users on the default show the new value
    Api.instance.get('/users?role=user').then((list) {
      if (mounted) {
        setState(() => users = (list as List).map((u) => Map<String, dynamic>.from(u as Map)).toList()
          ..sort((a, b) => '${a['username']}'.compareTo('${b['username']}')));
      }
    }, onError: (_) {});
    final hot = <int, List<String>>{};
    for (final h in (widget.term['hot'] as List? ?? const []).cast<Map>()) {
      hot.putIfAbsent(asInt(h['bet_type_id']), () => []).add('${h['number']}');
    }
    for (final bt in widget.betTypes) {
      ctrls[asInt(bt['id'])] = TextEditingController(text: (hot[asInt(bt['id'])] ?? const []).join(' '));
    }
  }

  @override
  void dispose() {
    percent.dispose();
    for (final c in ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final pct = int.tryParse(percent.text.trim());
    if (pct == null || pct < 0 || pct > 100) {
      errorSnack(context, 'ရာခိုင်နှုန်း 0 မှ 100 အတွင်း ထည့်ပါ');
      return;
    }
    final numbers = <Map<String, dynamic>>[];
    for (final bt in widget.betTypes) {
      final digits = asInt(bt['digits']);
      for (final n in ctrls[asInt(bt['id'])]!.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty).toSet()) {
        if (!RegExp('^[0-9]{$digits}\$').hasMatch(n)) {
          errorSnack(context, '${bt['description']}: "$n" — $digits လုံး ဖြစ်ရပါမည်');
          return;
        }
        numbers.add({'bet_type_id': asInt(bt['id']), 'number': n});
      }
    }
    final badId = own.entries.where((e) => e.value < 0 || e.value > 100).map((e) => e.key).firstOrNull;
    if (badId != null) {
      final name = users.where((u) => asInt(u['id']) == badId).map((u) => '${u['username']}').firstOrNull ?? '#$badId';
      errorSnack(context, '$name: ရာခိုင်နှုန်း 0 မှ 100 အတွင်း ထည့်ပါ');
      return;
    }
    setState(() => busy = true);
    try {
      await Api.instance.put('/terms/${widget.term['id']}/hot', {
        'percent': pct,
        'numbers': numbers,
        // Only users whose % differs from the default are saved as their own.
        'users': [for (final e in own.entries) if (e.value != pct) {'user_id': e.key, 'percent': e.value}],
      });
      if (mounted) snack(context, 'ဟော့ဂဏန်း ${numbers.length} လုံး သိမ်းပြီးပါပြီ');
      widget.onSaved();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // ADD HOT dialog: numbers (space / comma separated) are checked for this bet type's length and
  // added to its hot-number box once each; သိမ်းမည် then stores them.
  Future<void> _addHot(Map<String, dynamic> bt) async {
    final digits = asInt(bt['digits']);
    final input = TextEditingController();
    String? error;
    final added = await showDialog<List<String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('ADD HOT — ${bt['description']}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: input,
              autofocus: true,
              textCapitalization: TextCapitalization.characters, // R, P, S, M …
              decoration: InputDecoration(
                labelText: 'ဂဏန်း / ပုံစံ',
                hintText: digits == 2 ? '12 12R 2* *2' : '123 123R 12* *12 1*2',
                helperText: 'ဂဏန်း သို့မဟုတ် ပုံစံ (12R, 2*, *2 …) — space / ကော်မာဖြင့် ခြားပါ',
                border: const OutlineInputBorder(),
              ),
            ),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: Colors.red))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(
              onPressed: () {
                // Each entry: a number or a sale pattern (12R -> 12,21 · 2* -> 20..29 · *2 -> 02..92 …),
                // expanded by the same parser as the sale screens.
                final typed = <String>[];
                for (final entry in input.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty)) {
                  final parsed = parseEntry(entry.toUpperCase(), digits);
                  if (!parsed.ok) return setSt(() => error = '$entry: ${parsed.error}');
                  for (final n in parsed.numbers) {
                    if (!typed.contains(n)) typed.add(n);
                  }
                }
                if (typed.isEmpty) return setSt(() => error = 'ဂဏန်း ထည့်ပါ');
                Navigator.pop(ctx, typed);
              },
              child: const Text('ထည့်မည်'),
            ),
          ],
        ),
      ),
    );
    if (added == null || !mounted) return;
    final box = ctrls[asInt(bt['id'])]!;
    final current = box.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty).toList();
    final fresh = added.where((n) => !current.contains(n)).toList();
    setState(() => box.text = [...current, ...fresh].join(' '));
    snack(context, 'ဟော့ဂဏန်း ${fresh.length} လုံး ထည့်ပြီး — သိမ်းရန် "သိမ်းမည်" နှိပ်ပါ');
  }


  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(12), children: [
      SectionCard(title: 'ဟော့ဂဏန်း (Hot numbers)', children: [
        Text('ဟော့ဂဏန်းတစ်လုံးစီကို ကစားသူတစ်ဦး ဤအပါတ်စဥ်ရှိ မိမိ၏ စုစုပေါင်းထိုးကြေး (စလစ်အားလုံး၊ လျှော့ငွေမနုတ်မီ) ၏ % အထိသာ ထိုးနိုင်သည်။ 0% = ပိတ်။',
            style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
        const SizedBox(height: 12),
        StatefulBuilder(builder: (ctx, setSt) {
          final pct = (int.tryParse(percent.text) ?? 0).clamp(0, 100);
          return TextField(
            controller: percent,
            enabled: !widget.locked,
            keyboardType: TextInputType.number,
            onChanged: (_) => setSt(() {}),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            decoration: InputDecoration(
              labelText: 'Default ဟော့ % (စာရင်းမဝင်သော ကစားသူများ)',
              suffixText: '%',
              helperText: 'ဥပမာ — စုစုပေါင်းထိုးကြေး 100,000 ဆိုလျှင် ဟော့ဂဏန်းတစ်လုံးစီကို ${100000 * pct ~/ 100} အထိ',
              border: const OutlineInputBorder(),
              isDense: true,
            ),
          );
        }),
        const SizedBox(height: 12),
        for (final bt in widget.betTypes) ...[
          // ADD HOT: numbers typed in a dialog are added to the box below (သိမ်းမည် stores them).
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: widget.locked ? null : () => _addHot(bt),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('ADD HOT'),
            ),
          ),
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TextField(
              controller: ctrls[asInt(bt['id'])],
              enabled: !widget.locked,
              keyboardType: TextInputType.number,
              minLines: 2,
              maxLines: 4,
              decoration: InputDecoration(
                labelText: '${bt['description']} — ဟော့ဂဏန်းများ',
                hintText: asInt(bt['digits']) == 2 ? 'ဥပမာ 00 11 99' : 'ဥပမာ 123 456',
                helperText: 'space သို့မဟုတ် ကော်မာဖြင့် ခြားပါ',
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
        ],
        // User + % rows: every user, at the default % until given their own (highlighted; ↺ = back to default).
        const Text('ကစားသူအလိုက် ဟော့ %', style: TextStyle(fontWeight: FontWeight.w800)),
        if (users.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('ကစားသူ မရှိသေးပါ', style: TextStyle(color: Colors.grey))),
        for (final u in users)
          Builder(builder: (ctx) {
            final id = asInt(u['id']);
            final custom = own.containsKey(id);
            final defaultPct = int.tryParse(percent.text.trim()) ?? 0;
            return ListTile(
              key: ValueKey('hot-$id'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('${u['username']}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text(custom ? '${u['name'] ?? ''}' : '${u['name'] ?? ''} · default'),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 80,
                  child: TextFormField(
                    // Rebuilt with the new default while the user is still on it.
                    key: ValueKey(custom ? 'own-$id' : 'def-$id-$defaultPct'),
                    initialValue: '${custom ? own[id] : defaultPct}',
                    enabled: !widget.locked,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.right,
                    decoration: InputDecoration(
                      isDense: true,
                      suffixText: '%',
                      border: const OutlineInputBorder(),
                      filled: custom,
                      fillColor: const Color(0xFFFEF3C7),
                    ),
                    onChanged: (v) => own[id] = int.tryParse(v) ?? -1,
                  ),
                ),
                if (!widget.locked && custom)
                  IconButton(tooltip: 'Default % သို့ ပြန်ထားရန်', icon: const Icon(Icons.undo), onPressed: () => setState(() => own.remove(id))),
              ]),
            );
          }),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: widget.locked || busy ? null : _save,
          icon: const Icon(Icons.save),
          label: const Text('သိမ်းမည်'),
        ),
      ]),
    ]);
  }
}

// ---------------------------------------------------------------- Unit per number (per user)

class _UserLimitsTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  final bool locked;
  const _UserLimitsTab({required this.term, required this.betTypes, required this.locked});

  @override
  State<_UserLimitsTab> createState() => _UserLimitsTabState();
}

class _UserLimitsTabState extends State<_UserLimitsTab> {
  List<Map<String, dynamic>>? rows;
  List<Map<String, dynamic>> users = [];
  bool dirty = false;
  bool busy = false;
  String? error;

  int get typeId => asInt(widget.betTypes.isEmpty ? 0 : widget.betTypes.first['id']);
  int get cap => asInt(((widget.term['limits'] as List?) ?? const []).cast<Map>().where((l) => asInt(l['bet_type_id']) == typeId).map((l) => l['max_units']).firstOrNull);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([Api.instance.get('/terms/${widget.term['id']}/user-limits'), Api.instance.get('/users?role=user')]);
      if (!mounted) return;
      setState(() {
        rows = (results[0] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
        users = (results[1] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
        dirty = false;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _add() async {
    final taken = rows!.map((r) => asInt(r['user_id'])).toSet();
    final candidates = users.where((u) => !taken.contains(asInt(u['id']))).toList();
    final result = await showDialog<(Map<String, dynamic>, int)>(
      context: context,
      builder: (ctx) => _AddLimitDialog(users: candidates, cap: cap),
    );
    if (result == null) return;
    final (user, units) = result;
    setState(() {
      rows!.add({'user_id': user['id'], 'username': user['username'], 'name': user['name'], 'bet_type_id': typeId, 'max_units': units});
      rows!.sort((a, b) => '${a['username']}'.compareTo('${b['username']}'));
      dirty = true;
    });
  }

  Future<void> _save() async {
    final over = rows!.where((r) => cap > 0 && asInt(r['max_units']) > cap).firstOrNull;
    if (over != null) return errorSnack(context, '${over['username']}: ဘရိတ် ($cap) ထက် မကျော်ရ');
    if (rows!.any((r) => asInt(r['max_units']) <= 0)) return errorSnack(context, 'ယူနစ် 0 ထက် များရမည်');
    setState(() => busy = true);
    try {
      final saved = await Api.instance.put('/terms/${widget.term['id']}/user-limits', [
        for (final r in rows!) {'user_id': asInt(r['user_id']), 'bet_type_id': asInt(r['bet_type_id']), 'max_units': asInt(r['max_units'])},
      ]) as List;
      setState(() {
        rows = saved.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        dirty = false;
      });
      if (mounted) snack(context, 'သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (rows == null) return error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    return ListView(padding: const EdgeInsets.all(12), children: [
      SectionCard(
        title: 'ဂဏန်းတစ်ကွက် ယူနစ် (ကစားသူအလိုက်)',
        trailing: widget.locked ? null : TextButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: const Text('ထည့်မည်')),
        children: [
          Text('ဤအပါတ်စဥ်တွင် ကစားသူတစ်ဦး ဂဏန်းတစ်ကွက်ပေါ် အများဆုံးထိုးနိုင်သော ယူနစ်။ ဘရိတ် (${cap > 0 ? cap : 'မရှိ'}) ထက် မကျော်ရ။',
              style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
          const SizedBox(height: 8),
          if (rows!.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Center(child: Text('ကန့်သတ်ချက် မရှိသေးပါ — ဘရိတ်သာ သက်ရောက်သည်', style: TextStyle(color: Colors.grey)))),
          for (final r in rows!)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('${r['username']}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('${r['name'] ?? ''}'),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 84,
                  child: TextFormField(
                    initialValue: '${r['max_units']}',
                    enabled: !widget.locked,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.right,
                    decoration: InputDecoration(
                      isDense: true,
                      border: const OutlineInputBorder(),
                      errorText: cap > 0 && asInt(r['max_units']) > cap ? '≤ $cap' : null,
                    ),
                    onChanged: (v) {
                      r['max_units'] = int.tryParse(v) ?? 0;
                      setState(() => dirty = true);
                    },
                  ),
                ),
                if (!widget.locked)
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.red),
                    onPressed: () => setState(() {
                      rows!.remove(r);
                      dirty = true;
                    }),
                  ),
              ]),
            ),
          if (!widget.locked) ...[
            const SizedBox(height: 8),
            FilledButton.icon(onPressed: !dirty || busy ? null : _save, icon: const Icon(Icons.save), label: const Text('သိမ်းမည်')),
          ],
        ],
      ),
    ]);
  }
}

class _AddLimitDialog extends StatefulWidget {
  final List<Map<String, dynamic>> users;
  final int cap;
  const _AddLimitDialog({required this.users, required this.cap});

  @override
  State<_AddLimitDialog> createState() => _AddLimitDialogState();
}

class _AddLimitDialogState extends State<_AddLimitDialog> {
  Map<String, dynamic>? user;
  final _units = TextEditingController();
  String q = '';
  String? error;

  @override
  void initState() {
    super.initState();
    if (widget.cap > 0) _units.text = '${widget.cap}'; // starts at the break
  }

  @override
  Widget build(BuildContext context) {
    final list = widget.users.where((u) => q.isEmpty || '${u['username']} ${u['name']}'.toLowerCase().contains(q.toLowerCase())).toList();
    return AlertDialog(
      title: const Text('ကစားသူ ထည့်ရန်'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'ရှာရန်', isDense: true), onChanged: (v) => setState(() => q = v)),
          SizedBox(
            height: 220,
            child: RadioGroup<int>(
              groupValue: user == null ? null : asInt(user!['id']),
              onChanged: (id) => setState(() => user = list.firstWhere((u) => asInt(u['id']) == id)),
              child: ListView(children: [
                for (final u in list)
                  RadioListTile<int>(
                    dense: true,
                    value: asInt(u['id']),
                    title: Text('${u['username']}'),
                    subtitle: Text('${u['name'] ?? ''}'),
                  ),
              ]),
            ),
          ),
          TextField(
            controller: _units,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: 'အများဆုံး ယူနစ်${widget.cap > 0 ? ' (≤ ${widget.cap})' : ''}', border: const OutlineInputBorder(), isDense: true),
          ),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: Colors.red))),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('မလုပ်တော့ပါ')),
        FilledButton(
          onPressed: () {
            final v = int.tryParse(_units.text.trim()) ?? 0;
            if (user == null) return setState(() => error = 'ကစားသူ ရွေးပါ');
            if (v <= 0) return setState(() => error = 'ယူနစ် ထည့်ပါ');
            if (widget.cap > 0 && v > widget.cap) return setState(() => error = 'ဘရိတ် (${widget.cap}) ထက် မကျော်ရ');
            Navigator.pop(context, (user!, v));
          },
          child: const Text('ထည့်မည်'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- Results + settle

class _ResultsTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final VoidCallback onChanged;
  const _ResultsTab({required this.term, required this.onChanged});

  @override
  State<_ResultsTab> createState() => _ResultsTabState();
}

class _ResultsTabState extends State<_ResultsTab> {
  final _ctrl = TextEditingController();
  bool busy = false;
  // ငွေရှင်း: ticked (as it is from the start) = settle at once (winners paid); untick it to save the
  // result and close the term only ('drawn'), settled later with ငွေရှင်းမည် (Settle). A correction
  // always settles again.
  bool settleNow = true;

  bool get is3d => widget.term['game'] == '3D';
  int get slot => is3d ? 1 : 2;

  @override
  void initState() {
    super.initState();
    final r = (widget.term['results'] as List? ?? const []).cast<Map>().where((r) => asInt(r['slot']) == slot).map((r) => '${r['value']}').firstOrNull;
    _ctrl.text = r ?? '';
  }

  @override
  void didUpdateWidget(covariant _ResultsTab old) {
    super.didUpdateWidget(old);
    if (old.term['status'] != widget.term['status']) setState(() {});
  }

  Future<void> _saveResult() async {
    final v = _ctrl.text.trim();
    if (!RegExp(is3d ? r'^\d{3}$' : r'^\d{2}$').hasMatch(v)) return errorSnack(context, is3d ? 'ဂဏန်း ၃ လုံး ထည့်ပါ' : 'ဂဏန်း ၂ လုံး ထည့်ပါ');
    // On a settled term it is a correction: the winnings already paid are taken back and the slips
    // settled again on the new result.
    final correcting = widget.term['status'] == 'settled';
    final doSettle = correcting || settleNow;
    final note = correcting
        ? 'ယခင်ပေးပြီးသော ဆုငွေများကို user များထံမှ ပြန်နှုတ်ပြီး (သုံးပြီးသားဆိုလျှင် လက်ကျန် အနုတ် ဖြစ်နိုင်သည်) ဂဏန်းအသစ်ဖြင့် ငွေပြန်ရှင်းမည်။'
        : doSettle
            ? 'ပေါက်သော စလစ်များကို ဆုငွေ ချက်ချင်းပေးပြီး ငွေစာရင်းရှင်းမည်။ မှားပါက နောက်မှ ပြန်ပြင်နိုင်သည်။'
            : 'ပေါက်ဂဏန်းသိမ်းပြီး အပါတ်စဥ် ပိတ်ရုံသာ — ဆုငွေ မပေးရသေးပါ။ နောက်မှ "ငွေရှင်းမည်" ဖြင့် ရှင်းနိုင်သည်။';
    if (!await confirm(
        context,
        correcting ? 'ပေါက်ဂဏန်း $v သို့ ပြင်မလား?' : doSettle ? 'ပေါက်ဂဏန်း $v သိမ်းပြီး ငွေရှင်းမလား?' : 'ပေါက်ဂဏန်း $v သိမ်းပြီး ပိတ်မလား?',
        message: '${widget.term['description']}\n\n$note',
        ok: correcting ? 'ပြင်ပြီး ငွေပြန်ရှင်းမည်' : doSettle ? 'သိမ်းပြီး ငွေရှင်းမည်' : 'သိမ်းပြီး ပိတ်မည်',
        danger: doSettle)) {
      return;
    }
    setState(() => busy = true);
    try {
      final r = await Api.instance.put('/terms/${widget.term['id']}/results${doSettle ? '' : '?settle=0'}', [
        {'slot': slot, 'value': v, 'label': is3d ? '3D' : '2D'},
      ]) as Map;
      if (mounted) {
        final money = context.read<Session>().money;
        snack(
            context,
            r['settled'] == false
                ? 'ပေါက်ဂဏန်း သိမ်းပြီး အပါတ်စဥ် ပိတ်ပြီးပါပြီ (ငွေစာရင်း မရှင်းရသေး)'
                : '${r['corrected'] == true ? 'ပြင်ပြီး ငွေပြန်ရှင်းပြီးပါပြီ' : 'ငွေရှင်းပြီးပါပြီ'} — ပေါက် ${asInt(r['winning_tickets'])}/${asInt(r['tickets'])} စလစ် · ဆုငွေ ${money(asInt(r['payout']))} Ks');
      }
      widget.onChanged();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _settle() async {
    if (!await confirm(context, 'ငွေရှင်းမလား?', message: 'ပေါက်သော စလစ်များကို ဆုငွေ ပေးမည်။ ပြန်ပြင်၍ မရပါ။', ok: 'ငွေရှင်းမည်', danger: true)) return;
    setState(() => busy = true);
    try {
      final r = await Api.instance.post('/terms/${widget.term['id']}/settle') as Map;
      if (mounted) {
        final money = context.read<Session>().money;
        snack(context, 'ငွေရှင်းပြီးပါပြီ — ပေါက် ${asInt(r['winning_tickets'])}/${asInt(r['tickets'])} စလစ် · ဆုငွေ ${money(asInt(r['payout']))} Ks');
      }
      widget.onChanged();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = '${widget.term['status']}';
    final canEnter = ['open', 'closed', 'drawn', 'settled'].contains(status); // settled: correct the result
    final closes = parseDate(widget.term['close_at']);
    final notClosed = closes != null && DateTime.now().isBefore(closes);
    final twod = is3d ? twodNumbers(_ctrl.text.trim()) : const <String>[];
    return ListView(padding: const EdgeInsets.all(12), children: [
      SectionCard(title: is3d ? '3D ပေါက်ဂဏန်း' : '2D ပေါက်ဂဏန်း', children: [
        TextField(
          controller: _ctrl,
          enabled: canEnter && !busy,
          keyboardType: TextInputType.number,
          maxLength: is3d ? 3 : 2,
          textAlign: TextAlign.center,
          onChanged: (_) => setState(() {}),
          style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w900, letterSpacing: 10, color: Color(0xFFA855F7)),
          decoration: const InputDecoration(border: OutlineInputBorder(), counterText: ''),
        ),
        if (twod.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('တွဒ်: ${twod.join(', ')}', style: TextStyle(color: Colors.grey[700]))),
        if (notClosed && canEnter)
          const Padding(padding: EdgeInsets.only(top: 8), child: Text('ပိတ်ချိန် မရောက်သေးပါ — ပိတ်ပြီးမှ ပေါက်ဂဏန်း ထည့်နိုင်သည်', style: TextStyle(color: Color(0xFFD97706)))),
        const SizedBox(height: 8),
        if (status != 'settled')
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: settleNow,
            onChanged: canEnter && !busy ? (v) => setState(() => settleNow = v ?? false) : null,
            title: const Text('ငွေရှင်း', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        FilledButton.icon(
          onPressed: canEnter && !busy ? _saveResult : null,
          icon: const Icon(Icons.emoji_events),
          label: Text(status == 'settled'
              ? 'ပေါက်ဂဏန်း ပြင်ပြီး ငွေပြန်ရှင်းမည်'
              : settleNow
                  ? 'ပေါက်သီး သိမ်းပြီး ပိတ် + ငွေရှင်းမည်'
                  : 'ပေါက်သီး သိမ်းပြီး ပိတ်မည်'),
        ),
        if (status == 'settled')
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text('✅ ငွေရှင်းပြီးပါပြီ — ဂဏန်းမှားပါက အပေါ်တွင် ပြင်နိုင်သည်', style: TextStyle(color: Colors.grey[700])),
          ),
      ]),
      // A "drawn" term: result saved with ငွေရှင်း unticked, not yet settled.
      if (status == 'drawn')
        SectionCard(title: 'ငွေရှင်းရန်', children: [
          Text('ပေါက်ဂဏန်း စစ်ပြီးပါက ငွေရှင်းပါ — ပေါက်သော စလစ်များ၏ ဆုငွေ လက်ကျန်ငွေထဲ ဝင်မည်။', style: TextStyle(color: Colors.grey[700])),
          const SizedBox(height: 10),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669)),
            onPressed: busy ? null : _settle,
            icon: const Icon(Icons.payments),
            label: const Text('ငွေရှင်းမည် (Settle)'),
          ),
        ]),
    ]);
  }
}

// ---------------------------------------------------------------- Summary

class _SummaryTab extends StatefulWidget {
  final int termId;
  final int? folderId;
  final String title; // the term, for the ➤ shared text's header
  const _SummaryTab({required this.termId, this.folderId, required this.title});

  @override
  State<_SummaryTab> createState() => _SummaryTabState();
}

class _SummaryTabState extends State<_SummaryTab> {
  String groupBy = 'agent';
  String who = ''; // User / Agent select box (see PersonFilter): one person's rows only
  List<Map<String, dynamic>> rows = const []; // what ➤ shares
  final _loader = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();

  Future<List<Map<String, dynamic>>> _load() async {
    final list = ((await Api.instance.get('/reports/summary?term_id=${widget.termId}&group_by=$groupBy${personQuery(who)}')) as List)
        .map((r) => Map<String, dynamic>.from(r as Map))
        .toList();
    rows = list;
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.all(10),
        child: Row(children: [
          Expanded(
            child: SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'agent', label: Text('Agent အလိုက်')), ButtonSegment(value: 'user', label: Text('User အလိုက်'))],
              selected: {groupBy},
              showSelectedIcon: false,
              onSelectionChanged: (s) {
                setState(() => groupBy = s.first);
                _loader.currentState?.reload();
              },
            ),
          ),
          IconButton(
            icon: const Icon(Icons.send, color: Color(0xFF4338CA)),
            tooltip: 'စာရင်း ပို့ရန်',
            onPressed: rows.isEmpty
                ? null
                : () async {
                    final company = await Company.name();
                    await SharePlus.instance.share(ShareParams(
                        text: summaryText(rows, company: company, title: widget.title, who: who, money: session.money)));
                  },
          ),
        ]),
      ),
      // User / Agent အလိုက် စာရင်း (agent ရွေးပြီး User အလိုက် ကြည့်လျှင် ထို agent ၏ user များ)
      Padding(
        padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
        child: PersonFilter(
          value: who,
          onChanged: (v) {
            setState(() => who = v);
            _loader.currentState?.reload();
          },
        ),
      ),
      Expanded(
        child: Loader<List<Map<String, dynamic>>>(
          key: _loader,
          load: _load,
          builder: (ctx, rows, _) => rows.isEmpty ? const EmptyView('အရောင်း မရှိသေးပါ') : SummaryList(rows: rows, money: session.money, folderId: widget.folderId, termId: widget.termId),
        ),
      ),
    ]);
  }
}

// Sales / payout / profit rows with a total — used here and on the Report screen.
class SummaryList extends StatelessWidget {
  final List<Map<String, dynamic>> rows;
  final String Function(num) money;
  // 👁 opens the account's own စာရင်း starting on this ဖိုင် / term (what this table shows).
  final int? folderId;
  final int? termId;
  const SummaryList({super.key, required this.rows, required this.money, this.folderId, this.termId});

  @override
  Widget build(BuildContext context) {
    int total(String k) => rows.fold(0, (a, r) => a + asInt(r[k]));
    // row: an account's row — 👁 beside its name opens its own စာရင်း (AccountReportScreen).
    Widget line(String name, int tickets, int net, int payout, int profit, {bool bold = false, Map<String, dynamic>? row}) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(color: bold ? const Color(0xFFEEF2FF) : Colors.white, border: Border(bottom: BorderSide(color: Colors.grey.shade200))),
          child: Row(children: [
            Expanded(
              flex: 3,
              child: Row(children: [
                Flexible(child: Text(name, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w700))),
                if (row != null && row['id'] != null)
                  InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: () {
                      final n = '${row['name'] ?? ''}'.trim();
                      Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => AccountReportScreen(
                              userId: asInt(row['id']), title: '${row['username']}${n.isEmpty ? '' : ' ($n)'}', folderId: folderId, termId: termId)));
                    },
                    child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.visibility, size: 18, color: Color(0xFF4338CA))),
                  ),
              ]),
            ),
            Expanded(flex: 2, child: Text('$tickets', textAlign: TextAlign.center)),
            Expanded(flex: 3, child: Text(money(net), textAlign: TextAlign.right)),
            Expanded(flex: 3, child: Text(money(payout), textAlign: TextAlign.right, style: const TextStyle(color: Color(0xFF059669)))),
            Expanded(
              flex: 3,
              child: Text(money(profit),
                  textAlign: TextAlign.right,
                  style: TextStyle(fontWeight: FontWeight.w800, color: profit < 0 ? const Color(0xFFDC2626) : const Color(0xFF059669))),
            ),
          ]),
        );
    return ListView(children: [
      Container(
        color: Colors.grey.shade200,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: const Row(children: [
          Expanded(flex: 3, child: Text('အမည်', style: TextStyle(fontWeight: FontWeight.w700))),
          Expanded(flex: 2, child: Text('စလစ်', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700))),
          Expanded(flex: 3, child: Text('ရောင်း', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700))),
          Expanded(flex: 3, child: Text('ဆုငွေ', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700))),
          Expanded(flex: 3, child: Text('အမြတ်', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700))),
        ]),
      ),
      for (final r in rows) line('${r['username']}', asInt(r['tickets']), asInt(r['net']), asInt(r['payout']), asInt(r['profit']), row: r),
      if (rows.length > 1) line('စုစုပေါင်း', total('tickets'), total('net'), total('payout'), total('profit'), bold: true),
    ]);
  }
}

// ---------------------------------------------------------------- အဝယ်

// အဝယ် (admin): ကျွံ = units bet on a number − the break − units already bought. Each number over
// the break is listed with a units box filled with its ကျွံ (type more to buy more, 0 to skip);
// ADD puts other numbers / patterns on the list. Saving records the purchase: it takes the units off
// the ကျွံ and, after the result, shows what the dealer owes on winners. No wallet moves.
class _PurchaseTab extends StatefulWidget {
  final Map<String, dynamic> term;
  final List<Map<String, dynamic>> betTypes;
  const _PurchaseTab({required this.term, required this.betTypes});

  @override
  State<_PurchaseTab> createState() => _PurchaseTabState();
}

class _PurchaseLine {
  final int betTypeId;
  final String number;
  final int? units, breakUnits, purchased, excess; // null: a number added by hand
  final TextEditingController buy;
  _PurchaseLine(this.betTypeId, this.number, {this.units, this.breakUnits, this.purchased, this.excess, int buy = 0})
      : buy = TextEditingController(text: '$buy');
}

class _PurchaseTabState extends State<_PurchaseTab> {
  Map<String, dynamic>? data;
  List<_PurchaseLine> lines = [];
  final odds = <int, TextEditingController>{};
  final _note = TextEditingController();
  bool busy = false;
  String? error;

  bool get editable => ['open', 'closed'].contains(data?['status']);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final l in lines) {
      l.buy.dispose();
    }
    for (final c in odds.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  void _show(Map<String, dynamic> d) {
    for (final l in lines) {
      l.buy.dispose();
    }
    lines = [
      for (final r in (d['excess'] as List).cast<Map>())
        _PurchaseLine(asInt(r['bet_type_id']), '${r['number']}',
            units: asInt(r['units']), breakUnits: asInt(r['break_units']), purchased: asInt(r['purchased']), excess: asInt(r['excess']), buy: asInt(r['excess'])),
    ];
    final m = (d['multipliers'] as Map?) ?? const {};
    for (final bt in widget.betTypes) {
      final id = asInt(bt['id']);
      odds.putIfAbsent(id, () => TextEditingController()).text = '${m['$id'] ?? 0}';
    }
    data = d;
  }

  Future<void> _load() async {
    try {
      final d = Map<String, dynamic>.from(await Api.instance.get('/terms/${widget.term['id']}/purchases') as Map);
      if (!mounted) return;
      setState(() {
        _show(d);
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _add(Map<String, dynamic> bt) async {
    final digits = asInt(bt['digits']);
    final numbersCtrl = TextEditingController();
    final unitsCtrl = TextEditingController();
    String? err;
    final added = await showDialog<(List<String>, int)>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('ADD — ${bt['description']}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: numbersCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: 'ဂဏန်း / ပုံစံ',
                hintText: digits == 2 ? '12 12R 2* *2' : '123 123R 12* *12 1*2',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: unitsCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'ယူနစ်', border: OutlineInputBorder()),
            ),
            if (err != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(err!, style: const TextStyle(color: Colors.red))),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(
              onPressed: () {
                final units = int.tryParse(unitsCtrl.text.trim()) ?? 0;
                if (units <= 0) return setSt(() => err = 'ယူနစ် ထည့်ပါ');
                final typed = <String>[];
                for (final entry in numbersCtrl.text.split(RegExp(r'[\s,]+')).where((x) => x.isNotEmpty)) {
                  final parsed = parseEntry(entry.toUpperCase(), digits);
                  if (!parsed.ok) return setSt(() => err = '$entry: ${parsed.error}');
                  for (final n in parsed.numbers) {
                    if (!typed.contains(n)) typed.add(n);
                  }
                }
                if (typed.isEmpty) return setSt(() => err = 'ဂဏန်း ထည့်ပါ');
                Navigator.pop(ctx, (typed, units));
              },
              child: const Text('ထည့်မည်'),
            ),
          ],
        ),
      ),
    );
    if (added == null || !mounted) return;
    final (numbers, units) = added;
    setState(() {
      for (final n in numbers) {
        final line = lines.where((l) => l.betTypeId == asInt(bt['id']) && l.number == n).firstOrNull;
        if (line != null) {
          line.buy.text = '${(int.tryParse(line.buy.text) ?? 0) + units}';
        } else {
          lines.add(_PurchaseLine(asInt(bt['id']), n, buy: units));
        }
      }
    });
  }

  Future<void> _save() async {
    final money = context.read<Session>().money;
    final items = [
      for (final l in lines)
        if ((int.tryParse(l.buy.text.trim()) ?? 0) > 0) {'bet_type_id': l.betTypeId, 'number': l.number, 'units': int.parse(l.buy.text.trim())},
    ];
    if (items.isEmpty) return errorSnack(context, 'ဝယ်မည့် ယူနစ် ထည့်ပါ');
    final units = items.fold<int>(0, (a, i) => a + (i['units'] as int));
    if (!await confirm(context, 'အဝယ်ရိုက်မလား?',
        message: 'ဂဏန်း ${items.length} လုံး · ${money(units)} ယူနစ် (${money(units * asInt(data!['unit_price']))} Ks)', ok: 'အဝယ်ရိုက်မည်')) {
      return;
    }
    setState(() => busy = true);
    try {
      final d = Map<String, dynamic>.from(await Api.instance.post('/terms/${widget.term['id']}/purchases', {
        'items': items,
        'multiplier': {for (final e in odds.entries) '${e.key}': int.tryParse(e.value.text.trim()) ?? 0},
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      }) as Map);
      if (!mounted) return;
      snack(context, 'အဝယ် သိမ်းပြီး');
      _note.clear();
      setState(() => _show(d));
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _remove(Map p) async {
    if (!await confirm(context, '${p['number']} × ${p['units']} ယူနစ် အဝယ်ကို ဖျက်မလား?', ok: 'ဖျက်မည်', danger: true)) return;
    try {
      final d = Map<String, dynamic>.from(await Api.instance.delete('/terms/${widget.term['id']}/purchases/${p['id']}') as Map);
      if (mounted) setState(() => _show(d));
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = data;
    if (d == null) return error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    final money = context.read<Session>().money;
    final typeName = {for (final bt in widget.betTypes) asInt(bt['id']): '${bt['description']}'};
    final many = widget.betTypes.length > 1;
    final purchases = (d['purchases'] as List).cast<Map>();
    final totals = (d['totals'] as Map?) ?? const {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        if (!editable)
          const Card(
            color: Color(0xFFFFF7ED),
            child: Padding(padding: EdgeInsets.all(12), child: Text('ပေါက်သီး ထည့်ပြီးနောက် အဝယ် အသစ် မရိုက်နိုင်ပါ။')),
          ),
        SectionCard(title: 'ကျွံဂဏန်းများ — အဝယ်', children: [
          Text('ဘရိတ်ထက် ပိုထိုးထားသော ယူနစ်များ။ ဝယ်မည့် ယူနစ်ကို ပြင်နိုင်သည် (ကျွံထက် ပိုဝယ်လို့ရ၊ 0 = မဝယ်)။',
              style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            for (final bt in widget.betTypes)
              OutlinedButton.icon(
                onPressed: editable ? () => _add(bt) : null,
                icon: const Icon(Icons.add, size: 18),
                label: Text(many ? 'ADD ${bt['description']}' : 'ADD'),
              ),
          ]),
          const SizedBox(height: 6),
          if (lines.isEmpty)
            const Padding(padding: EdgeInsets.all(8), child: Text('ဘရိတ်ကျော် ကျွံဂဏန်း မရှိပါ', style: TextStyle(color: Colors.grey))),
          for (final l in lines)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 6),
              decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Colors.grey.shade200))),
              child: Row(children: [
                SizedBox(
                  width: 56,
                  child: Text(l.number, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                ),
                Expanded(
                  child: Text(
                    l.units == null
                        ? '${many ? '${typeName[l.betTypeId]} · ' : ''}ထပ်ထည့်'
                        : '${many ? '${typeName[l.betTypeId]} · ' : ''}ထိုး ${money(l.units!)} · ဘရိတ် ${money(l.breakUnits!)}'
                            '${(l.purchased ?? 0) > 0 ? ' · ဝယ်ပြီး ${money(l.purchased!)}' : ''}\nကျွံ ${money(l.excess!)}',
                    style: TextStyle(fontSize: 12, color: Colors.grey[700]),
                  ),
                ),
                SizedBox(
                  width: 90,
                  child: TextField(
                    controller: l.buy,
                    enabled: editable,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.right,
                    decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), suffixText: 'ယူ'),
                  ),
                ),
              ]),
            ),
          const SizedBox(height: 10),
          Wrap(spacing: 10, runSpacing: 10, children: [
            for (final bt in widget.betTypes)
              SizedBox(
                width: 160,
                child: TextField(
                  controller: odds[asInt(bt['id'])],
                  enabled: editable,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: 'ဒိုင် အဆ (${bt['description']})', isDense: true, border: const OutlineInputBorder()),
                ),
              ),
          ]),
          const SizedBox(height: 10),
          TextField(
            controller: _note,
            enabled: editable,
            decoration: const InputDecoration(labelText: 'ဒိုင် / မှတ်ချက် (မဖြည့်လည်းရ)', isDense: true, border: OutlineInputBorder()),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: editable && !busy ? _save : null,
            icon: const Icon(Icons.shopping_cart_checkout),
            label: const Text('အဝယ်ရိုက်မည်'),
          ),
        ]),
        SectionCard(title: 'အဝယ်စာရင်း (${purchases.length})', children: [
          Text(
            'ယူနစ် ${money(asInt(totals['units']))} · ${money(asInt(totals['amount']))} Ks'
            '${d['has_results'] == true ? ' · ဒိုင်မှ ရရန် ဆုငွေ ${money(asInt(totals['win']))} Ks' : ''}',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          if (purchases.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('အဝယ် မရှိသေးပါ', style: TextStyle(color: Colors.grey))),
          for (final p in purchases)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('${p['number']} × ${money(asInt(p['units']))} ယူနစ်  ·  အဆ ${p['multiplier']}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text([
                dateTime(p['created_at']),
                '${money(asInt(p['amount']))} Ks',
                if (asInt(p['win']) > 0) 'ဆုငွေ ${money(asInt(p['win']))}',
                if (p['note'] != null) '${p['note']}',
              ].join(' · ')),
              trailing: editable
                  ? IconButton(icon: const Icon(Icons.delete_outline, color: Colors.red), tooltip: 'ဖျက်ရန်', onPressed: () => _remove(p))
                  : null,
            ),
        ]),
      ]),
    );
  }
}
