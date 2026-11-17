import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// One account's စာရင်း, opened with 👁 on a စာရင်း row: the same per-term view the user app shows
// the user (GET /reports/mine?user_id=…) — for an agent / master, every slip of the users under it.
// Filters: ဖိုင် and အပါတ်စဥ် (from the rows) and ငွေရှင်း (from the server). Opened from a စာရင်း
// table it starts on that table's ဖိုင် / term.
class AccountReportScreen extends StatefulWidget {
  final int userId;
  final String title; // "username (name)"
  final int? folderId; // start on this ဖိုင်
  final int? termId; // start on this term
  const AccountReportScreen({super.key, required this.userId, required this.title, this.folderId, this.termId});

  @override
  State<AccountReportScreen> createState() => _AccountReportScreenState();
}

class _AccountReportScreenState extends State<AccountReportScreen> {
  int? folderId; // null = every ဖိုင်
  int? termId; // null = every term (of the ဖိုင်)
  String cleared = ''; // '' all, '1' ငွေရှင်းပြီး only, '0' not yet
  List<Map<String, dynamic>>? rows;
  String? error;

  @override
  void initState() {
    super.initState();
    folderId = widget.folderId;
    termId = widget.termId;
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.instance.get('/reports/mine?user_id=${widget.userId}&limit=200${cleared.isEmpty ? '' : '&cleared=$cleared'}') as List;
      if (!mounted) return;
      setState(() {
        rows = data.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        if (!rows!.any((r) => asInt(r['folder_id']) == folderId)) folderId = null;
        if (!_inFolder.any((r) => asInt(r['term_id']) == termId)) termId = null;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  // The rows of the picked ဖိုင် (folder_id is null for a term outside any ဖိုင်, which asInt reads as 0).
  List<Map<String, dynamic>> get _inFolder => (rows ?? const []).where((r) => folderId == null || asInt(r['folder_id']) == folderId).toList();
  List<Map<String, dynamic>> get shown => _inFolder.where((r) => termId == null || asInt(r['term_id']) == termId).toList();
  int _total(String key) => shown.fold(0, (a, r) => a + asInt(r[key]));
  // Profit / loss counts settled terms only — the others have no winnings yet (as in the user app).
  int get _result => shown.where((r) => r['status'] == 'settled').fold(0, (a, r) => a + asInt(r['result']));

  @override
  Widget build(BuildContext context) {
    final money = context.read<Session>().money;
    InputDecoration deco(String l) => InputDecoration(labelText: l, border: const OutlineInputBorder(), isDense: true);
    final all = _inFolder;
    // The ဖိုင်s the rows touch, in the rows' (newest first) order.
    final folders = <int, String>{};
    for (final r in rows ?? const <Map<String, dynamic>>[]) {
      if (r['folder_id'] != null) folders.putIfAbsent(asInt(r['folder_id']), () => '${r['folder_name'] ?? ''}');
    }
    return Scaffold(
      appBar: AppBar(title: Text('စာရင်း — ${widget.title}', overflow: TextOverflow.ellipsis)),
      body: Column(children: [
        if (folders.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: DropdownButtonFormField<int?>(
              key: ValueKey('folder-$folderId-${folders.length}'),
              initialValue: folderId,
              isExpanded: true,
              decoration: deco('ဖိုင်'),
              items: [
                const DropdownMenuItem(value: null, child: Text('ဖိုင် အားလုံး')),
                for (final f in folders.entries) DropdownMenuItem(value: f.key, child: Text('📁 ${f.value}', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() {
                folderId = v;
                termId = null;
              }),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
          child: Row(children: [
            Expanded(
              child: DropdownButtonFormField<int?>(
                key: ValueKey('term-$termId-${all.length}'),
                initialValue: termId,
                isExpanded: true,
                decoration: deco('အပါတ်စဥ်'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('အပါတ်စဥ် အားလုံး')),
                  for (final r in all)
                    DropdownMenuItem(
                      value: asInt(r['term_id']),
                      child: Text('${folderId == null && r['folder_name'] != null ? '📁 ${r['folder_name']} · ' : ''}${r['description']}', overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (v) => setState(() => termId = v),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: cleared,
                isExpanded: true,
                decoration: deco('ငွေရှင်း'),
                items: const [
                  DropdownMenuItem(value: '', child: Text('အားလုံး')),
                  DropdownMenuItem(value: '1', child: Text('ငွေရှင်းပြီး')),
                  DropdownMenuItem(value: '0', child: Text('ငွေမရှင်းရသေး')),
                ],
                onChanged: (v) {
                  setState(() {
                    cleared = v ?? '';
                    rows = null;
                  });
                  _load();
                },
              ),
            ),
          ]),
        ),
        Expanded(child: _body(money)),
      ]),
    );
  }

  Widget _body(String Function(num) money) {
    if (rows == null) return error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    if (shown.isEmpty) return const EmptyView('အချက်အလက် မရှိသေးပါ');
    final result = _result;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 6, 12, 24), children: [
        Row(children: [
          _Stat('စလစ်', money(_total('tickets'))),
          const SizedBox(width: 8),
          _Stat('ထိုးငွေ', money(_total('net'))),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          _Stat('ဆုငွေ', money(_total('win')), color: const Color(0xFF059669)),
          const SizedBox(width: 8),
          _Stat('အမြတ် / အရှုံး', '${result > 0 ? '+' : ''}${money(result)}', color: result >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626)),
        ]),
        const SizedBox(height: 10),
        for (final r in shown) _TermCard(row: r, money: money),
        const SizedBox(height: 6),
        Text('ပယ်ဖျက်ထားသော စလစ်များ မပါဝင်ပါ။ အမြတ်/အရှုံး = ဆုငွေ − ထိုးငွေ (ဆုငွေရှင်းပြီးသော အပါတ်စဥ်များ)။ ✓ ငွေရှင်းပြီး = ဤအကောင့်နှင့် ငွေစာရင်း ရှင်းပြီးကြောင်း မှတ်ထားသည်။',
            style: TextStyle(color: Colors.grey[600], fontSize: 12)),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _Stat(this.label, this.value, {this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.grey.shade200)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 12)),
            FittedBox(child: Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: color))),
          ]),
        ),
      );
}

class _TermCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final String Function(num) money;
  const _TermCard({required this.row, required this.money});

  @override
  Widget build(BuildContext context) {
    final settled = row['status'] == 'settled';
    final result = asInt(row['result']);
    Widget cell(String label, String value, {Color? color}) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[600])),
            Text(value, style: TextStyle(fontWeight: FontWeight.w800, color: color)),
          ]),
        );
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: Colors.grey.shade200)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            GameCircle('${row['game']}'),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${row['description']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                if (row['folder_name'] != null) Text('📁 ${row['folder_name']}', style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
              ]),
            ),
            termBadge(row['status']),
          ]),
          if (row['cleared_at'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: StatusChip('✓ ငွေရှင်းပြီး · ${dateTime(row['cleared_at'])}', const Color(0xFF059669)),
            ),
          const SizedBox(height: 8),
          Row(children: [
            cell('စလစ်', '${row['tickets']}'),
            cell('ထိုးငွေ', money(asInt(row['net']))),
            cell('ဆုငွေ', asInt(row['win']) > 0 ? money(asInt(row['win'])) : '—', color: const Color(0xFF059669)),
            cell('အမြတ်/အရှုံး', settled ? '${result > 0 ? '+' : ''}${money(result)}' : '—',
                color: settled ? (result >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626)) : null),
          ]),
          if (asInt(row['discount']) > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('စုစုပေါင်း ${money(asInt(row['gross']))} · ကော် ${money(asInt(row['discount']))}',
                  style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
            ),
        ]),
      ),
    );
  }
}
