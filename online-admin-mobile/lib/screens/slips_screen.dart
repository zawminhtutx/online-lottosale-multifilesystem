import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/pattern_parser.dart';
import '../services/session.dart';
import '../services/slip_text.dart';
import '../widgets/common.dart';
import '../widgets/person_filter.dart';

// စလစ်များ — every user's slips (latest 500): filter by term, status, user/agent or search; tap for
// details, edit (lower units / remove lines) or cancel an active slip (refunds the difference / the
// stake). ➤ shares the listed slips as text. Also embedded in a term's စလစ် tab.
class SlipsScreen extends StatelessWidget {
  const SlipsScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('စလစ်များ')), body: const SlipList());
}

class SlipList extends StatefulWidget {
  final int? termId;
  final bool embedded;
  const SlipList({super.key, this.termId, this.embedded = false});

  @override
  State<SlipList> createState() => _SlipListState();
}

class _SlipListState extends State<SlipList> with AutomaticKeepAliveClientMixin {
  List<Map<String, dynamic>>? slips;
  String? error;
  String status = '';
  String search = '';
  int? folderFilter;
  int? termFilter;
  // User / Agent select box (see PersonFilter): the server filters on tickets.user_id /
  // tickets.agent_id, so the latest 500 that come back are that one's slips.
  String who = '';
  final Map<int, String> folderNames = {};
  final Map<int, String> termNames = {}; // kept across reloads so the အပါတ်စဥ် box does not shrink
  final Map<int, int> termFolder = {}; // term_id → folder_id, so the term box follows the ဖိုင်
  void Function()? _stopLive;

  static const _statuses = [('', 'အားလုံး'), ('active', 'ထိုးထား'), ('won', 'ပေါက်'), ('lost', 'မပေါက်'), ('cancelled', 'ပယ်ဖျက်')];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    _stopLive = Live.instance.listen('tickets', (m) {
      if (m['reconnected'] == true || widget.termId == null || asInt(m['term_id']) == widget.termId) _load();
    });
  }

  @override
  void dispose() {
    _stopLive?.call();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final q = (widget.termId != null ? '&term_id=${widget.termId}' : '') + personQuery(who);
      final rows = await Api.instance.get('/tickets?limit=500$q') as List;
      if (!mounted) return;
      setState(() {
        slips = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        for (final s in slips!) {
          final fid = asInt(s['folder_id']);
          folderNames[fid] = s['folder_name'] == null ? 'ဖိုင်မရှိ' : '${s['folder_name']}';
          termNames[asInt(s['term_id'])] = '${s['term_description']}';
          termFolder[asInt(s['term_id'])] = fid;
        }
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  // edit: open straight into the ပြင်ရန် dialog (the row's ✏️ button).
  Future<void> _open(Map<String, dynamic> s, {bool edit = false}) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => SlipDetailSheet(ticketId: asInt(s['id']), startEdit: edit),
    );
    if (changed == true) _load();
  }

  // The row's 🗑 button: cancel the slip and refund the stake (logged for the user).
  Future<void> _delete(Map<String, dynamic> s) async {
    final session = context.read<Session>();
    if (!await confirm(context, 'စလစ် ${s['slip_no']} ဖျက်မလား?',
        message: '${session.money(asInt(s['net_amount']))} Ks ကို ${s['username']} ထံ ပြန်အမ်းမည်။', ok: 'ဖျက်မည်', danger: true)) {
      return;
    }
    try {
      await Api.instance.post('/tickets/${s['id']}/cancel');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('စလစ် ${s['slip_no']} ဖျက်ပြီး ငွေပြန်အမ်းပြီး'), backgroundColor: Colors.teal));
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  // ➤ ပို့ရန်: the slips as listed (term / status / user-agent / search all applied) as plain text
  // for Viber, Telegram, SMS ... through the share sheet.
  Future<void> _send(List<Map<String, dynamic>> shown) async {
    final money = context.read<Session>().money;
    final live = shown.where((s) => s['status'] != 'cancelled');
    final b = StringBuffer('Online Lotto — စလစ်များ\n');
    final termName = termNames[widget.termId ?? termFilter];
    if (termName != null) b.writeln(termName);
    final person = personLabel(who);
    if (person != null) b.writeln(person);
    if (status.isNotEmpty) b.writeln(_statuses.firstWhere((e) => e.$1 == status).$2);
    b.writeln('----------------------');
    for (final s in shown) {
      final (label, _) = ticketStatus[s['status']] ?? ('${s['status']}', Colors.grey);
      final win = asInt(s['win_amount']);
      b.writeln('${displaySlipNo(s)} · ${s['username']} · ${money(asInt(s['net_amount']))}'
          '${win > 0 ? ' · ဆု ${money(win)}' : ''}${s['status'] == 'active' ? '' : ' · $label'}');
    }
    b
      ..writeln('----------------------')
      ..writeln('စလစ်: ${live.length}')
      ..writeln('ရောင်း: ${money(live.fold<int>(0, (a, s) => a + asInt(s['net_amount'])))} Ks')
      ..writeln('ဆုငွေ: ${money(live.fold<int>(0, (a, s) => a + asInt(s['win_amount'])))} Ks');
    await SharePlus.instance.share(ShareParams(text: b.toString()));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final session = context.read<Session>();
    if (slips == null) return error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator());
    final shown = slips!.where((s) {
      if (status.isNotEmpty && s['status'] != status) return false;
      if (folderFilter != null && asInt(s['folder_id']) != folderFilter) return false;
      if (termFilter != null && asInt(s['term_id']) != termFilter) return false;
      if (search.isNotEmpty && !'${s['username']} ${s['user_name']} ${s['slip_no']}'.toLowerCase().contains(search.toLowerCase())) return false;
      return true;
    }).toList();
    final termsInFolder = <int, String>{
      for (final e in termNames.entries)
        if (folderFilter != null && termFolder[e.key] == folderFilter) e.key: e.value,
    };
    final live = shown.where((s) => s['status'] != 'cancelled');
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
        child: TextField(
          decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'User / Slip ရှာရန်', isDense: true, border: OutlineInputBorder()),
          onChanged: (v) => setState(() => search = v.trim()),
        ),
      ),
      if (widget.termId == null)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Row(children: [
            Expanded(
              child: DropdownButtonFormField<int?>(
                key: ValueKey('folder-$folderFilter-${folderNames.length}'),
                initialValue: folderNames.containsKey(folderFilter) ? folderFilter : null,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), labelText: 'ဖိုင်'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('ဖိုင် အားလုံး')),
                  for (final e in folderNames.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setState(() {
                  folderFilter = v;
                  termFilter = null;
                }),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: DropdownButtonFormField<int?>(
                key: ValueKey('term-$folderFilter-$termFilter-${termsInFolder.length}'),
                initialValue: termsInFolder.containsKey(termFilter) ? termFilter : null,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), labelText: 'အပါတ်စဥ်'),
                items: [
                  DropdownMenuItem(value: null, child: Text(folderFilter == null ? 'ဖိုင် အရင်ရွေးပါ' : 'အပါတ်စဥ် အားလုံး')),
                  for (final e in termsInFolder.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: folderFilter == null ? null : (v) => setState(() => termFilter = v),
              ),
            ),
          ]),
        ),
      // User / Agent အလိုက် စလစ်များ ကြည့်ရန်
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: PersonFilter(
          value: who,
          onChanged: (v) {
            setState(() => who = v); // the old rows stay until the filtered ones arrive
            _load();
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        child: DropdownButtonFormField<String>(
          key: ValueKey('status-$status'),
          initialValue: status,
          isExpanded: true,
          decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), labelText: 'အခြေအနေ'),
          items: [
            for (final (v, label) in _statuses) DropdownMenuItem(value: v, child: Text(label)),
          ],
          onChanged: (v) => setState(() => status = v ?? ''),
        ),
      ),
      Container(
        margin: const EdgeInsets.symmetric(horizontal: 12),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: const Color(0xFFFEF9C3), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Text('စလစ် ${live.length}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const Spacer(),
          Text('ရောင်း ${session.money(live.fold<int>(0, (a, s) => a + asInt(s['net_amount'])))}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(width: 12),
          Text('ဆုငွေ ${session.money(live.fold<int>(0, (a, s) => a + asInt(s['win_amount'])))}',
              style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF059669))),
          IconButton(
            icon: const Icon(Icons.send, size: 20, color: Color(0xFF4338CA)),
            tooltip: 'စာရင်း ပို့ရန်',
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(),
            padding: const EdgeInsets.only(left: 10),
            onPressed: shown.isEmpty ? null : () => _send(shown),
          ),
        ]),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: shown.isEmpty
              ? const EmptyView('စလစ် မရှိပါ')
              : ListView.separated(
                  itemCount: shown.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (ctx, i) {
                    final s = shown[i];
                    final (label, color) = ticketStatus[s['status']] ?? ('${s['status']}', Colors.grey);
                    final win = asInt(s['win_amount']);
                    return ListTile(
                      onTap: () => _open(s),
                      contentPadding: const EdgeInsets.only(left: 16, right: 4),
                      // can_manage 0: a slip seen through view-all (outside the caller's tree): no actions.
                      trailing: s['status'] == 'active' && s['can_manage'] != 0
                          ? Row(mainAxisSize: MainAxisSize.min, children: [
                              IconButton(icon: const Icon(Icons.edit, color: Colors.indigo), tooltip: 'ပြင်ရန်', onPressed: () => _open(s, edit: true)),
                              IconButton(icon: const Icon(Icons.delete_outline, color: Colors.red), tooltip: 'ဖျက်ရန်', onPressed: () => _delete(s)),
                            ])
                          : null,
                      title: Row(children: [
                        Text(displaySlipNo(s), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(width: 6),
                        StatusChip(label, color),
                        const Spacer(),
                        Text(session.money(asInt(s['net_amount'])), style: const TextStyle(fontWeight: FontWeight.w800)),
                      ]),
                      subtitle: Row(children: [
                        Expanded(
                          child: Text('${s['username']} · ${widget.termId == null ? '${s['term_description']} · ' : ''}${dateTime(s['created_at'])}',
                              style: const TextStyle(fontSize: 11.5), overflow: TextOverflow.ellipsis),
                        ),
                        if (win > 0) Text('+${session.money(win)}', style: const TextStyle(color: Color(0xFF059669), fontWeight: FontWeight.w800, fontSize: 12)),
                      ]),
                    );
                  },
                ),
        ),
      ),
    ]);
  }
}

// One slip: lines, totals, and Edit / Cancel (active slips only). Pops true when changed.
class SlipDetailSheet extends StatefulWidget {
  final int ticketId;
  final bool startEdit; // open the ပြင်ရန် dialog as soon as the slip is loaded
  const SlipDetailSheet({super.key, required this.ticketId, this.startEdit = false});

  @override
  State<SlipDetailSheet> createState() => _SlipDetailSheetState();
}

class _SlipDetailSheetState extends State<SlipDetailSheet> {
  Map<String, dynamic>? t;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/tickets/${widget.ticketId}').then((v) {
      if (!mounted) return;
      setState(() => t = Map<String, dynamic>.from(v as Map));
      if (widget.startEdit && t!['status'] == 'active') _edit();
    }).catchError((e) {
      if (mounted) setState(() => error = '$e');
    });
  }

  Future<void> _cancel() async {
    if (!await confirm(context, 'စလစ် ပယ်ဖျက်မလား?', message: 'ထိုးငွေကို ကစားသူထံ ပြန်အမ်းမည်။', ok: 'ပယ်ဖျက်မည်', danger: true)) return;
    setState(() => busy = true);
    try {
      await Api.instance.post('/tickets/${widget.ticketId}/cancel');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // ပြင်ရန်: each line's units can be lowered (0 removes the line); the server refunds the
  // difference and logs the change for the user. Raising units is not allowed (that is a new slip).
  Future<void> _edit() async {
    final items = (t!['items'] as List).cast<Map>();
    final ctrls = {for (final i in items) asInt(i['id']): TextEditingController(text: '${i['units']}')};
    String? err;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          title: Text('စလစ် ${t!['slip_no']} ပြင်ရန်'),
          content: SizedBox(
            width: double.maxFinite,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('ယူနစ် လျှော့နိုင်သည် (0 = ထိုလိုင်း ဖျက်)။ လျော့သွားသော ငွေကို ကစားသူထံ ပြန်အမ်းမည်။',
                  style: TextStyle(fontSize: 12.5, color: Colors.grey[700])),
              const SizedBox(height: 8),
              Flexible(
                child: ListView(shrinkWrap: true, children: [
                  for (final i in items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(children: [
                        Expanded(child: Text('${i['number']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                        Text('/ ${i['units']}  ', style: TextStyle(color: Colors.grey[600])),
                        SizedBox(
                          width: 80,
                          child: TextField(
                            controller: ctrls[asInt(i['id'])],
                            keyboardType: TextInputType.number,
                            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                            textAlign: TextAlign.right,
                            decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), suffixText: 'u'),
                          ),
                        ),
                      ]),
                    ),
                ]),
              ),
              if (err != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(err!, style: const TextStyle(color: Colors.red))),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့')),
            FilledButton(
              onPressed: () {
                for (final i in items) {
                  final v = int.tryParse(ctrls[asInt(i['id'])]!.text);
                  if (v == null || v > asInt(i['units'])) {
                    setDialog(() => err = '${i['number']} — ယူနစ် 0 မှ ${i['units']} အထိသာ');
                    return;
                  }
                }
                Navigator.pop(ctx, true);
              },
              child: const Text('သိမ်းမည်'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final changes = [
      for (final i in items)
        if (int.parse(ctrls[asInt(i['id'])]!.text) != asInt(i['units'])) {'id': asInt(i['id']), 'units': int.parse(ctrls[asInt(i['id'])]!.text)},
    ];
    if (changes.isEmpty) return;
    setState(() => busy = true);
    try {
      final before = asInt(t!['net_amount']);
      final saved = Map<String, dynamic>.from(await Api.instance.patch('/tickets/${widget.ticketId}/items', {'items': changes}) as Map);
      if (!mounted) return;
      final refund = saved['status'] == 'cancelled' ? before : before - asInt(saved['net_amount']);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('စလစ် ပြင်ပြီး · ${context.read<Session>().money(refund)} Ks ပြန်အမ်းပြီး'),
        backgroundColor: Colors.teal,
      ));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final ticket = t;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * .85),
        child: ticket == null
            ? SizedBox(height: 200, child: Center(child: error != null ? Text(error!) : const CircularProgressIndicator()))
            : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 8, 0),
                  child: Row(children: [
                    Text('Slip ${displaySlipNo(ticket)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                    const SizedBox(width: 8),
                    () {
                      final (label, color) = ticketStatus[ticket['status']] ?? ('${ticket['status']}', Colors.grey);
                      return StatusChip(label, color);
                    }(),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                  ]),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text('${ticket['username']} (${ticket['user_name']}) · ${ticket['term_description']} · ${dateTime(ticket['created_at'])}',
                      style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView(shrinkWrap: true, children: [
                    for (final l in slipLines(ticket))
                      Container(
                        color: l.items.any((i) => asInt(i['is_winner']) == 1) ? const Color(0xFFD1FAE5) : null,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Row(children: [
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(l.numbers.length > 1 ? '${patternLabel(l.label)} (${l.numbers.length})' : l.label,
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                              if (l.numbers.length > 1) Text(l.numbers.join(' '), style: TextStyle(fontSize: 11, color: Colors.grey[600])),
                            ]),
                          ),
                          Text('${l.units}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        ]),
                      ),
                  ]),
                ),
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: [
                    _row('စုစုပေါင်း', '${session.money(asInt(ticket['gross_amount']))} Ks'),
                    if (asInt(ticket['discount_amount']) > 0) _row('ကော်မရှင်', '− ${session.money(asInt(ticket['discount_amount']))} Ks'),
                    _row('ပေးချေပြီး', '${session.money(asInt(ticket['net_amount']))} Ks', bold: true),
                    if (asInt(ticket['win_amount']) > 0) _row('ဆုငွေ', '${session.money(asInt(ticket['win_amount']))} Ks', bold: true),
                    if (ticket['status'] == 'active' && ticket['can_manage'] != false) ...[
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: busy ? null : _edit,
                            icon: const Icon(Icons.edit),
                            label: const Text('ပြင်ရန်'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                            onPressed: busy ? null : _cancel,
                            icon: const Icon(Icons.block),
                            label: const Text('ပယ်ဖျက်ရန်'),
                          ),
                        ),
                      ]),
                    ],
                  ]),
                ),
              ]),
      ),
    );
  }

  Widget _row(String a, String b, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Text(a, style: TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w600)),
          const Spacer(),
          Text(b, style: TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w600)),
        ]),
      );
}
