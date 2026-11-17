import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import '../widgets/folder_term_filter.dart';
import '../widgets/responsive_layout.dart';

// စာရင်းများကြည့် — the user's own betting per term: slips, bet amount, commission, winnings and
// profit/loss. Filters: ဖိုင် → အပါတ်စဥ် (on the phone) and ငွေရှင်း (from the server); View reloads.
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  int? folderId; // ဖိုင် first, then one of its terms
  int? termId;
  String cleared = ''; // '' all, '1' ငွေရှင်းပြီး only, '0' not yet
  List<Map<String, dynamic>> rows = [];
  bool loading = false;
  bool viewed = false;
  String? error;

  @override
  void initState() {
    super.initState();
    _view(); // loads straight away so the folder / term boxes have something to list
  }

  List<Map<String, dynamic>> get shown => rows.where((r) => FolderTermFilter.matches(r, folderId, termId)).toList();

  Future<void> _view() async {
    setState(() {
      loading = true;
      viewed = true;
    });
    try {
      final data = await Api.instance.get('/reports/mine${cleared.isEmpty ? '' : '?cleared=$cleared'}') as List;
      rows = data.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  int _total(String key) => shown.fold(0, (a, r) => a + asInt(r[key]));
  // Profit/loss counts only settled terms — others have no winnings yet.
  int get _result => shown.where((r) => r['status'] == 'settled').fold(0, (a, r) => a + asInt(r['result']));

  Future<void> _send() async {
    if (shown.isEmpty) return;
    final money = context.read<Session>().money;
    final b = StringBuffer('Online Lotto — စာရင်း\n----------------------\n');
    for (final r in shown) {
      b.writeln('${r['description']} (${r['game']})');
      b.writeln('  စလစ် ${r['tickets']} · ထိုးငွေ ${money(asInt(r['net']))} · ဆုငွေ ${money(asInt(r['win']))}');
    }
    b
      ..writeln('----------------------')
      ..writeln('ထိုးငွေ: ${money(_total('net'))} Ks')
      ..writeln('ဆုငွေ: ${money(_total('win'))} Ks')
      ..writeln('အမြတ်/အရှုံး: ${money(_result)} Ks');
    await SharePlus.instance.share(ShareParams(text: b.toString()));
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    // Dashboard look: indigo gradient, glass filter, lavender View pill, white result cards.
    return DashScaffold(
      title: const Text('စာရင်းများကြည့်', style: TextStyle(fontWeight: FontWeight.w700)),
      actions: [
        if (shown.isNotEmpty) GlassIconButton(icon: Icons.send, tooltip: 'ပို့ရန်', onPressed: _send),
        const SizedBox(width: 16),
      ],
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: FolderTermFilter(
            rows: rows,
            termNameKey: 'description',
            folderId: folderId,
            termId: termId,
            onChanged: (folder, term) => setState(() {
              folderId = folder;
              termId = term;
            }),
          ),
        ),
        // ငွေရှင်းပြီး: terms the admin has marked settled up for me.
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: DropdownButtonFormField<String>(
            initialValue: cleared,
            isExpanded: true,
            dropdownColor: Dash.bottom,
            iconEnabledColor: Colors.white,
            style: const TextStyle(color: Colors.white, fontSize: 15),
            decoration: dashInput('ငွေရှင်း'),
            items: const [
              DropdownMenuItem(value: '', child: Text('အားလုံး')),
              DropdownMenuItem(value: '1', child: Text('ငွေရှင်းပြီးသော အပါတ်စဥ်များ')),
              DropdownMenuItem(value: '0', child: Text('ငွေမရှင်းရသေးသော အပါတ်စဥ်များ')),
            ],
            onChanged: (v) {
              setState(() => cleared = v ?? '');
              _view();
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFE4E4FB),
                foregroundColor: Dash.ink,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: const StadiumBorder(),
                textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              onPressed: loading ? null : _view,
              icon: loading
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Dash.ink))
                  : const Icon(Icons.visibility),
              label: const Text('View'),
            ),
          ),
        ),
        Expanded(child: _resultView(session)),
      ]),
    );
  }

  Widget _resultView(Session session) {
    if (!viewed) return const Center(child: Text('စာရင်းရွေးပြီး View ကိုနှိပ်ပါ', style: TextStyle(color: Colors.white70)));
    if (loading) return const Center(child: CircularProgressIndicator(color: Colors.white));
    if (error != null) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white))));
    if (shown.isEmpty) return const Center(child: Text('အချက်အလက် မရှိသေးပါ', style: TextStyle(color: Colors.white70)));
    final result = _result;
    return ContentWidth(maxWidth: 900, child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
      GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 2.4,
        children: [
          _Stat('စလစ်', session.money(_total('tickets'))),
          _Stat('ထိုးငွေ (အသားတင်)', '${session.money(_total('net'))} Ks'),
          _Stat('ဆုငွေ', '${session.money(_total('win'))} Ks', color: const Color(0xFF059669)),
          _Stat('အမြတ် / အရှုံး', '${result > 0 ? '+' : ''}${session.money(result)} Ks',
              color: result >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626)),
        ],
      ),
      const SizedBox(height: 12),
      for (final r in shown) _TermRow(row: r, money: session.money),
    ]));
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _Stat(this.label, this.value, {this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 12)),
        FittedBox(child: Text(value, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: color))),
      ]),
    );
  }
}

class _TermRow extends StatelessWidget {
  final Map<String, dynamic> row;
  final String Function(num) money;
  const _TermRow({required this.row, required this.money});

  @override
  Widget build(BuildContext context) {
    final (label, color) = termStatus[row['status']] ?? ('${row['status']}', Colors.grey);
    final settled = row['status'] == 'settled';
    final result = asInt(row['result']);
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      color: Colors.white,
      surfaceTintColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            GameCircle('${row['game']}', radius: 14),
            const SizedBox(width: 8),
            Expanded(child: Text('${row['description']}', style: const TextStyle(fontWeight: FontWeight.w800))),
            StatusChip(label, color),
          ]),
          if (row['cleared_at'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: StatusChip('✓ ငွေရှင်းပြီး · ${dateTime(row['cleared_at'])}', const Color(0xFF059669)),
            ),
          const SizedBox(height: 8),
          Row(children: [
            _Cell('စလစ်', '${row['tickets']}'),
            _Cell('ထိုးငွေ', money(asInt(row['net']))),
            _Cell('ဆုငွေ', asInt(row['win']) > 0 ? money(asInt(row['win'])) : '—', color: const Color(0xFF059669)),
            _Cell('အမြတ်/အရှုံး', settled ? '${result > 0 ? '+' : ''}${money(result)}' : '—',
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

class _Cell extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _Cell(this.label, this.value, {this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[600])),
        Text(value, style: TextStyle(fontWeight: FontWeight.w800, color: color)),
      ]),
    );
  }
}
