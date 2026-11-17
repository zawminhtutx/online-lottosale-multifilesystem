import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/pattern_parser.dart';
import '../services/company.dart';
import '../services/printer_service.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import '../widgets/folder_term_filter.dart';
import '../services/slip_text.dart';
import 'slip_edit_log_screen.dart';

// စလစ်များ — the user's own slips, like the POS mobile app's Slips screen: အပါတ်စဥ် filter, one
// row per slip (slip no, amount, term · date) with View and Send. Online slips can't be edited
// or deleted here; the app bar's history button lists what the admin changed (ပြင်/ဖျက် စာရင်း).
class SlipsScreen extends StatefulWidget {
  const SlipsScreen({super.key});

  @override
  State<SlipsScreen> createState() => _SlipsScreenState();
}

class _SlipsScreenState extends State<SlipsScreen> {
  List<Map<String, dynamic>> slips = [];
  List<Map<String, dynamic>> terms = []; // every term the user can see: the ဖိုင် → အပါတ်စဥ် boxes list them all
  bool loading = true;
  String? error;
  int? filterFolderId; // ဖိုင် first, then one of its terms
  int? filterTermId;
  String filterStatus = '';
  final _cache = <int, Map<String, dynamic>>{};

  static const _statusFilters = [('', 'အားလုံး'), ('active', 'ထိုးထား'), ('won', 'ပေါက်'),('cancelled', 'ပယ်ဖျက်')];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final results = await Future.wait([Api.instance.get('/tickets?limit=500'), Api.instance.get('/terms')]);
      slips = (results[0] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      terms = (results[1] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      _cache.clear();
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  Future<Map<String, dynamic>> _ticket(int id) async =>
      _cache[id] ??= Map<String, dynamic>.from(await Api.instance.get('/tickets/$id') as Map);

  List<Map<String, dynamic>> get _shown => slips
      .where((s) => FolderTermFilter.matches(s, filterFolderId, filterTermId) && (filterStatus.isEmpty || s['status'] == filterStatus))
      .toList();

  Future<void> _openDetail(Map<String, dynamic> s) async {
    Map<String, dynamic> t;
    List results = const [];
    try {
      t = await _ticket(asInt(s['id']));
      final term = await Api.instance.get('/terms/${t['term_id']}').catchError((_) => null);
      if (term is Map) results = (term['results'] as List?) ?? const [];
    } catch (e) {
      _snack('$e');
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => _SlipDetail(ticket: t, results: results, onSend: () => _send(s), onPrint: () => _print(s)),
    );
  }

  Future<void> _print(Map<String, dynamic> s) async {
    final session = context.read<Session>();
    try {
      final t = await _ticket(asInt(s['id']));
      await PrinterService.printSaved(t, username: '${session.user?['username'] ?? ''}', money: session.money);
      _cache.remove(asInt(s['id'])); // copy count changed
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ပရင့်ထုတ်ပြီးပါပြီ'), backgroundColor: Colors.teal));
      }
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _send(Map<String, dynamic> s) async {
    try {
      final t = await _ticket(asInt(s['id']));
      if (!mounted) return;
      final money = context.read<Session>().money;
      final header = Company.slipHeader((await PrinterSettings.load()).header);
      await SharePlus.instance.share(ShareParams(text: slipText(t, header: header, money: money)));
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _requestDelete(Map<String, dynamic> s) async {
    if (s['status'] != 'active' || s['cancel_request'] == 'pending') return;
    final money = context.read<Session>().money;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('စလစ် ဖျက်ရန် request'),
        content: Text('စလစ် S${s['term_id']}-${s['slip_no']} (${money(asInt(s['net_amount']))} ကျပ်) ကို ဖျက်ရန် admin ထံ တောင်းမလား?\n\nApprove လုပ်မှ ဖျက်ပြီး ငွေပြန်အမ်းပါမည်။'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.pop(ctx, true), child: const Text('Request ပို့မည်')),
        ],
      ),
    );
    if (go != true) return;
    try {
      await Api.instance.post('/slip-cancel-requests', {'ticket_id': asInt(s['id'])});
      s['cancel_request'] = 'pending';
      if (mounted) {
        setState(() {});
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ဖျက်ရန် request ပို့ပြီးပါပြီ'), backgroundColor: Colors.teal));
      }
    } catch (e) {
      _snack('$e');
    }
  }

  void _snack(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: Colors.red));
  }

  Widget _slipAction({required IconData icon, required String label, required VoidCallback? onPressed, Color? color}) {
    final on = onPressed != null;
    final c = on ? (color ?? Colors.white) : Colors.white38;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: Material(
          color: Colors.white.withValues(alpha: on ? .18 : .08),
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(children: [
                Icon(icon, color: c, size: 20),
                const SizedBox(height: 3),
                Text(label, style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 11)),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final shown = _shown;
    final live = shown.where((s) => s['status'] != 'cancelled');
    final total = live.fold<int>(0, (a, s) => a + asInt(s['net_amount']));
    final units = live.fold<int>(0, (a, s) => a + asInt(s['total_units']));
    final won = live.fold<int>(0, (a, s) => a + asInt(s['win_amount']));
    // Dashboard look: indigo gradient, glass slip rows (the slip detail sheet stays white).
    return DashScaffold(
      title: const Text('စလစ်များ', style: TextStyle(fontWeight: FontWeight.w700)),
      actions: [
        IconButton(
          icon: const Icon(Icons.history),
          tooltip: 'ပြင်/ဖျက် စာရင်း',
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SlipEditLogScreen())),
        ),
        Container(
          margin: const EdgeInsets.only(right: 16),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(30)),
          child: Text(session.money(total), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
        ),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: FolderTermFilter(
            rows: slips,
            allTerms: terms,
            termNameKey: 'term_description',
            folderId: filterFolderId,
            termId: filterTermId,
            onChanged: (folder, term) => setState(() {
              filterFolderId = folder;
              filterTermId = term;
            }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: DropdownButtonFormField<String>(
            initialValue: filterStatus,
            isExpanded: true,
            dropdownColor: Dash.bottom,
            iconEnabledColor: Colors.white,
            style: const TextStyle(color: Colors.white, fontSize: 15),
            decoration: dashInput('အခြေအနေ'),
            items: [
              for (final (value, label) in _statusFilters) DropdownMenuItem(value: value, child: Text(label)),
            ],
            onChanged: (v) => setState(() => filterStatus = v ?? ''),
          ),
        ),
        Container(
          margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(gradient: Dash.highlight, borderRadius: BorderRadius.circular(16)),
          child: Row(children: [
            Text('စလစ် ${live.length}', style: const TextStyle(color: Dash.ink, fontWeight: FontWeight.w700)),
            const Spacer(),
            Text('Total - $units', style: const TextStyle(color: Dash.ink, fontWeight: FontWeight.w700)),
            const SizedBox(width: 14),
            Text('Prize ${session.money(won)}', style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF047857))),
          ]),
        ),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator(color: Colors.white))
              : error != null
                  ? Center(
                      child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: shown.isEmpty
                          // A term picked that the user has no slips in: nothing at all is shown.
                          ? ListView(children: [
                              if (filterTermId == null) ...const [
                                SizedBox(height: 120),
                                Center(child: Text('Slip မရှိသေးပါ', style: TextStyle(color: Colors.white70))),
                              ],
                            ])
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                              itemCount: shown.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                final s = shown[i];
                                final win = asInt(s['win_amount']);
                                final pendingDelete = s['cancel_request'] == 'pending';
                                final canAskDelete = s['status'] == 'active' && !pendingDelete;
                                return Container(
                                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
                                  decoration: Dash.glassBox(radius: 16),
                                  child: Column(children: [
                                    InkWell(
                                      onTap: () => _openDetail(s),
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Row(children: [
                                          Text('S${s['term_id']}-${s['slip_no']}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                                          const Spacer(),
                                          Text('${asInt(s['total_units'])}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                                        ]),
                                        const SizedBox(height: 4),
                                        Row(children: [
                                          Expanded(
                                            child: Text('${dateTime(s['created_at'])}  ·  ${session.money(asInt(s['net_amount']))}',
                                                style: const TextStyle(fontSize: 12, color: Colors.white70), overflow: TextOverflow.ellipsis),
                                          ),
                                          if (win > 0)
                                            Text('+${session.money(win)}', style: const TextStyle(color: Dash.green, fontWeight: FontWeight.w800, fontSize: 12.5)),
                                        ]),
                                        if (pendingDelete)
                                          const Padding(
                                            padding: EdgeInsets.only(top: 4),
                                            child: Text('ဖျက်ရန် စောင့်ဆဲ', style: TextStyle(color: Dash.amber, fontWeight: FontWeight.w700, fontSize: 12)),
                                          ),
                                      ]),
                                    ),
                                    const SizedBox(height: 10),
                                    Row(children: [
                                      _slipAction(icon: Icons.visibility_outlined, label: 'ကြည့်', onPressed: () => _openDetail(s)),
                                      _slipAction(icon: Icons.print_outlined, label: 'ပရင့်', onPressed: () => _print(s)),
                                      _slipAction(icon: Icons.send_outlined, label: 'ပို့', onPressed: () => _send(s)),
                                      _slipAction(
                                        icon: pendingDelete ? Icons.hourglass_top : Icons.delete_outline,
                                        label: pendingDelete ? 'စောင့်' : 'ဖျက်',
                                        color: canAskDelete || pendingDelete ? Dash.red : null,
                                        onPressed: canAskDelete ? () => _requestDelete(s) : null,
                                      ),
                                    ]),
                                  ]),
                                );
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}

class _SlipDetail extends StatelessWidget {
  final Map<String, dynamic> ticket;
  final List results;
  final VoidCallback onSend;
  final VoidCallback onPrint;
  const _SlipDetail({required this.ticket, required this.results, required this.onSend, required this.onPrint});

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final (label, color) = ticketStatus[ticket['status']] ?? ('${ticket['status']}', Colors.grey);
    final r3 = results.cast<Map>().where((r) => asInt(r['slot']) == 1).map((r) => '${r['value']}').firstOrNull;
    final r2 = results.cast<Map>().where((r) => asInt(r['slot']) == 2).map((r) => '${r['value']}').firstOrNull;
    final lines = slipLines(ticket);
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * .85),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 8, 4),
            child: Row(children: [
              Text('Slip S${ticket['term_id']}-${ticket['slip_no']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
              if (ticket['status'] != 'active') ...[const SizedBox(width: 8), StatusChip(label, color)],
              const Spacer(),
              IconButton(icon: const Icon(Icons.print, color: Colors.blueGrey), onPressed: onPrint),
              IconButton(icon: const Icon(Icons.send, color: Color(0xFF7C3AED)), onPressed: onSend),
              IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text('${ticket['term_description']}  ·  ${dateTime(ticket['created_at'])}', style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
          ),
          if (r3 != null || r2 != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Row(children: [
                if (r2 != null) Expanded(child: _ResultBox('2D ထွက်ဂဏန်း', r2)),
                if (r2 != null && r3 != null) const SizedBox(width: 8),
                if (r3 != null) Expanded(child: _ResultBox('3D ထွက်ဂဏန်း', r3)),
              ]),
            ),
          const SizedBox(height: 10),
          Container(
            color: const Color(0xFFEDE9FE),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: const Row(children: [
              Expanded(flex: 3, child: Text('ဂဏန်း', style: TextStyle(fontWeight: FontWeight.w700))),
              Expanded(flex: 2, child: Text('ယူနစ်', textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w700))),
            ]),
          ),
          Flexible(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: lines.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final l = lines[i];
                // winning lines stay highlighted green (no ဆုငွေ column; the slip's total is at the bottom)
                final win = l.items.fold<int>(0, (a, it) => a + asInt(it['win_amount']));
                return Container(
                  color: win > 0 ? const Color(0xFFD1FAE5) : null,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                  child: Row(children: [
                    Expanded(
                      flex: 3,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(l.numbers.length > 1 ? '${patternLabel(l.label)} (${l.numbers.length})' : l.label,
                            style: const TextStyle(fontWeight: FontWeight.w800)),
                        if (l.numbers.length > 1)
                          Text(l.numbers.join(' '), style: TextStyle(fontSize: 11, color: Colors.grey[600], fontFamily: 'monospace')),
                      ]),
                    ),
                    Expanded(flex: 2, child: Text('${l.units}', textAlign: TextAlign.right)),
                  ]),
                );
              },
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
            child: Column(children: [
              _TotalRow('Total', '${session.money(asInt(ticket['gross_amount']))} ကျပ်', bold: true),
              if (asInt(ticket['win_amount']) > 0)
                _TotalRow('Prize', '${session.money(asInt(ticket['win_amount']))} ကျပ်', bold: true, color: const Color(0xFF059669)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _ResultBox extends StatelessWidget {
  final String label;
  final String value;
  const _ResultBox(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(border: Border.all(color: Colors.grey.shade300), borderRadius: BorderRadius.circular(10)),
      child: Column(children: [
        Text(label, style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
        Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, letterSpacing: 3, color: Color(0xFFA855F7))),
      ]),
    );
  }
}

class _TotalRow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;
  final Color? color;
  const _TotalRow(this.label, this.value, {this.bold = false, this.color});

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w600, fontSize: bold ? 16 : 14, color: color);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [Text(label, style: style), const Spacer(), Text(value, style: style)]),
    );
  }
}
