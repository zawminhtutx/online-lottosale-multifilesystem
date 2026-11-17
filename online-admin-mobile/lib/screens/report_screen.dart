import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api.dart';
import '../services/report_text.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import '../widgets/person_filter.dart';
import 'term_detail_screen.dart';
import 'terms_screen.dart';

// စာရင်း — pick a term, then sales / payout / profit by agent or by user (like the POS mobile
// app's report screen: choose, View, table). ➤ shares the table as text.
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  List<Map<String, dynamic>> folders = []; // ဖိုင် select box
  int? folderId; // null = ဖိုင် အားလုံး
  List<Map<String, dynamic>> terms = [];
  int? termId;
  String groupBy = 'agent'; // an agent has no agents under it: its rows are its users (initState)
  String who = ''; // User / Agent select box (see PersonFilter): one person's rows only
  List<Map<String, dynamic>>? rows;
  bool loading = false;
  String? error;

  @override
  void initState() {
    super.initState();
    if (context.read<Session>().isAgent) groupBy = 'user';
    _loadFolders();
    _loadTerms();
  }

  Future<void> _loadFolders() async {
    try {
      final list = await loadFolders();
      if (mounted) setState(() => folders = list);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  // အပါတ်စဥ် box: with a ဖိုင် picked it is every term in that folder (draft / cancelled ones too —
  // their status is on the row); ဖိုင် အားလုံး keeps the recent list without drafts.
  Future<void> _loadTerms() async {
    try {
      final v = await Api.instance.get(folderId == null ? '/terms' : '/terms?folder_id=$folderId') as List;
      var list = v.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      if (folderId == null) list = list.where((t) => t['status'] != 'draft' && t['status'] != 'cancelled').toList();
      if (!mounted) return;
      setState(() {
        terms = list;
        error = null;
        // The picked term is gone from the new list (another folder): back to nothing picked.
        if (!list.any((t) => asInt(t['id']) == termId)) {
          termId = null;
          rows = null;
        }
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  // A term picked -> that term; only a ဖိုင် picked ("အပါတ်စဥ် အားလုံး") -> every term in it at
  // once, one row per person for the whole folder (GET /reports/summary takes folder_id for that).
  Future<void> _view() async {
    if (termId == null && folderId == null) return;
    final what = termId != null ? 'term_id=$termId' : 'folder_id=$folderId';
    setState(() => loading = true);
    try {
      final data = await Api.instance.get('/reports/summary?$what&group_by=$groupBy${personQuery(who)}') as List;
      rows = data.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  // ➤ ပို့ရန်: the table as shown (term + agent/user grouping) as plain text for Viber, Telegram,
  // SMS ... through the share sheet.
  Future<void> _send() async {
    final list = rows;
    if (list == null || list.isEmpty) return;
    final term = terms.firstWhere((t) => asInt(t['id']) == termId, orElse: () => const <String, dynamic>{});
    final folder = folders.firstWhere((f) => asInt(f['id']) == folderId, orElse: () => const <String, dynamic>{});
    // With no term picked the table is the whole ဖိုင်, so the text is headed with the ဖိုင်'s name.
    final title = termId != null ? '${term['description'] ?? ''}' : '${folder['name'] ?? ''}';
    final money = context.read<Session>().money;
    final company = await Company.name();
    await SharePlus.instance.share(ShareParams(text: summaryText(list, company: company, title: title, who: who, money: money)));
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final hasRows = rows != null && rows!.isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: const Text('စာရင်း'),
        actions: [
          IconButton(icon: const Icon(Icons.send), tooltip: 'စာရင်း ပို့ရန်', onPressed: hasRows ? _send : null),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(children: [
        // ဖိုင် — ရွေးလိုက်လျှင် အောက်က အပါတ်စဥ် box တွင် ထိုဖိုင်ထဲက အပါတ်စဥ်အားလုံး ပေါ်သည်။
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
          child: DropdownButtonFormField<int?>(
            key: ValueKey('folder-$folderId-${folders.length}'),
            initialValue: folderId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'ဖိုင်', border: OutlineInputBorder(), isDense: true),
            items: [
              const DropdownMenuItem(value: null, child: Text('ဖိုင် အားလုံး')),
              for (final f in folders)
                DropdownMenuItem(
                  value: asInt(f['id']),
                  child: Text('📁 ${f['name']}', overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (v) {
              setState(() {
                folderId = v;
                rows = null;
              });
              _loadTerms();
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
          child: DropdownButtonFormField<int?>(
            key: ValueKey('term-$termId-${terms.length}'),
            initialValue: termId,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: folderId == null ? 'အပါတ်စဥ်' : 'အပါတ်စဥ် (${terms.length})',
              border: const OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              // Only with a ဖိုင် picked: the report then covers every term in that folder.
              if (folderId != null) const DropdownMenuItem(value: null, child: Text('အပါတ်စဥ် အားလုံး')),
              for (final t in terms)
                DropdownMenuItem(value: asInt(t['id']), child: Text('${t['description']} · ${t['game']} · ${termStatusOf(t['status']).$1}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() {
              termId = v;
              rows = null;
            }),
          ),
        ),
        // User / Agent အလိုက် စာရင်း (agent ရွေးပြီး User အလိုက် ကြည့်လျှင် ထို agent ၏ user များ)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: PersonFilter(
            value: who,
            onChanged: (v) => setState(() {
              who = v;
              rows = null;
            }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
          child: SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'agent', label: Text('Agent အလိုက်')), ButtonSegment(value: 'user', label: Text('User အလိုက်'))],
            selected: {groupBy},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() {
              groupBy = s.first;
              rows = null;
            }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
          child: Row(children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: (termId == null && folderId == null) || loading ? null : _view,
                icon: loading
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.visibility),
                label: const Text('View'),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: termId == null ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TermDetailScreen(termId: termId!))),
              child: const Text('အပါတ်စဥ် ဖွင့်ရန်'),
            ),
          ]),
        ),
        const Divider(height: 1),
        Expanded(
          child: error != null && rows == null
              ? Center(child: Text(error!))
              : rows == null
                  ? const Center(child: Text('ဖိုင် / အပါတ်စဥ် ရွေးပြီး View ကိုနှိပ်ပါ', style: TextStyle(color: Colors.grey)))
                  : rows!.isEmpty
                      ? const Center(child: Text('အရောင်း မရှိသေးပါ', style: TextStyle(color: Colors.grey)))
                      : SummaryList(rows: rows!, money: session.money, folderId: folderId, termId: termId),
        ),
      ]),
    );
  }
}
