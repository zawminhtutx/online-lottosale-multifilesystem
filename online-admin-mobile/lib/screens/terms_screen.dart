import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/live.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import 'term_detail_screen.dart';

Future<List<Map<String, dynamic>>> loadFolders() async {
  final rows = await Api.instance.get('/term-folders') as List;
  return rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
}

// New / rename folder (ဖိုင်). Returns the saved folder, or null when cancelled.
// A new folder also gets the ⚙ Auto အပါတ်စဥ် terms (one per template) for the picked day.
Future<Map<String, dynamic>?> editFolder(BuildContext context, [Map<String, dynamic>? folder]) async {
  final templates = folder == null ? ((await Api.instance.get('/term-folders/templates')) as List).cast<Map>() : const <Map>[];
  if (!context.mounted) return null;
  final name = TextEditingController(text: folder == null ? '' : '${folder['name']}');
  var from = DateTime.now();
  var to = from;
  var auto = true;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: Text(folder == null ? 'ဖိုင်အသစ်' : 'ဖိုင် အမည်ပြောင်းရန်'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: name,
              autofocus: true,
              maxLength: 60,
              decoration: const InputDecoration(labelText: 'ဖိုင်အမည်', hintText: 'ဥပမာ October 2026', border: OutlineInputBorder()),
            ),
            if (templates.isNotEmpty) ...[
              // One term per template for every day from … to.
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event),
                title: const Text('ရက်စွဲ (မှ – ထိ)'),
                subtitle: Text('${_dmy(from)}  →  ${_dmy(to)}'),
                onTap: () async {
                  final picked = await showDateRangePicker(
                    context: ctx,
                    initialDateRange: DateTimeRange(start: from, end: to),
                    firstDate: DateTime(from.year - 1),
                    lastDate: DateTime(from.year + 2),
                  );
                  if (picked != null) {
                    setLocal(() {
                      from = picked.start;
                      to = picked.end;
                    });
                  }
                },
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: auto,
                onChanged: (v) => setLocal(() => auto = v ?? true),
                title: Text('Auto အပါတ်စဥ် ဆောက်မည် — ရက်တိုင်း ${templates.length} ခု'),
                subtitle: Text(templates.map((x) => '${x['name']}'.isEmpty ? '${x['game']}' : '${x['name']}').join(', ')),
              ),
            ],
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(folder == null ? 'ဖန်တီးမည်' : 'သိမ်းမည်')),
        ],
      ),
    ),
  );
  if (ok != true || name.text.trim().isEmpty) return null;
  final body = <String, Object>{
    'name': name.text.trim(),
    if (templates.isNotEmpty) ...{'date': _ymd(from), 'date_to': _ymd(to), 'tz': _utcOffset(), 'auto_terms': auto},
  };
  final saved = folder == null
      ? await Api.instance.post('/term-folders', body)
      : await Api.instance.patch('/term-folders/${folder['id']}', body);
  return Map<String, dynamic>.from(saved as Map);
}

String _two(int n) => n.toString().padLeft(2, '0');
String _dmy(DateTime d) => '${_two(d.day)}-${_two(d.month)}-${d.year}';
String _ymd(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';
// This phone's UTC offset as +hh:mm (the auto terms' times are local times).
String _utcOffset() {
  final m = DateTime.now().timeZoneOffset.inMinutes;
  return '${m < 0 ? '-' : '+'}${_two(m.abs() ~/ 60)}:${_two(m.abs() % 60)}';
}

// ⚙ Auto အပါတ်စဥ်: the term list a new folder starts with (one term per row). Each row: name
// (after the date), type, unit price, open / close / draw time, break (1 if left blank).
class AutoTermsScreen extends StatefulWidget {
  const AutoTermsScreen({super.key});

  @override
  State<AutoTermsScreen> createState() => _AutoTermsScreenState();
}

class _AutoTermsScreenState extends State<AutoTermsScreen> {
  List<Map<String, dynamic>>? list;
  String? error;
  bool saving = false;
  final _name = TextEditingController();
  final _price = TextEditingController(text: '1');
  final _break = TextEditingController(text: '1');
  String game = '2D';
  TimeOfDay open = const TimeOfDay(hour: 9, minute: 30);
  TimeOfDay close = const TimeOfDay(hour: 11, minute: 59);
  TimeOfDay draw = const TimeOfDay(hour: 12, minute: 1);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await Api.instance.get('/term-folders/templates') as List;
      setState(() {
        list = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        error = null;
      });
    } catch (e) {
      setState(() => error = '$e');
    }
  }

  String _hm(TimeOfDay t) => '${_two(t.hour)}:${_two(t.minute)}';

  void _add() {
    final o = _hm(open), c = _hm(close), d = _hm(draw);
    if (!(o.compareTo(c) < 0 && c.compareTo(d) <= 0)) {
      errorSnack(context, 'ဖွင့်ချိန် < ပိတ်ချိန် ≤ Draw ချိန် ဖြစ်ရမည်');
      return;
    }
    final breakRaw = _break.text.trim();
    final unitBreak = breakRaw.isEmpty ? 1 : int.tryParse(breakRaw);
    if (unitBreak == null || unitBreak < 0) {
      errorSnack(context, 'ဘရိတ် ယူနစ် မှန်အောင် ထည့်ပါ');
      return;
    }
    setState(() {
      list!.add({
        'name': _name.text.trim(),
        'game': game,
        'unit_price': int.tryParse(_price.text) ?? 1,
        'unit_break': unitBreak,
        'open': o,
        'close': c,
        'draw': d,
      });
      _name.clear();
    });
  }

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      await Api.instance.put('/term-folders/templates', list!);
      if (!mounted) return;
      snack(context, 'Auto အပါတ်စဥ် ${list!.length} ခု သိမ်းပြီးပါပြီ');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget _timeField(String label, TimeOfDay value, void Function(TimeOfDay) onPicked) {
    return Expanded(
      child: InkWell(
        onTap: () async {
          final t = await showTimePicker(context: context, initialTime: value);
          if (t != null) setState(() => onPicked(t));
        },
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
          child: Text(_hm(value), style: const TextStyle(fontSize: 16)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = list;
    return Scaffold(
      appBar: AppBar(title: const Text('⚙ Auto အပါတ်စဥ်')),
      bottomNavigationBar: rows == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: FilledButton.icon(
                  onPressed: saving ? null : _save,
                  icon: const Icon(Icons.save),
                  label: Text('သိမ်းမည် (${rows.length} ခု)'),
                ),
              ),
            ),
      body: rows == null
          ? (error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : ContentWidth(
              child: ListView(padding: const EdgeInsets.all(12), children: [
                Text('ဖိုင်အသစ် ဆောက်တာနဲ့ ဒီစာရင်းထဲက တစ်ခုစီအတွက် အပါတ်စဥ် တစ်ခုစီ အလိုအလျောက် ဆောက်ပါမယ် '
                    '(၂ ခုရှိရင် ၂ ခု၊ ၆ ခုရှိရင် ၆ ခု)။ အမည် = ရက်စွဲ + အမည်။ ယူနစ်စျေးနှုန်း / ဘရိတ် မထည့်ရင် 1။ ဘရိတ် 0 = ကန့်သတ်ချက်မရှိ။',
                    style: TextStyle(color: Colors.grey[700], fontSize: 13)),
                const SizedBox(height: 8),
                if (rows.isEmpty)
                  const Padding(padding: EdgeInsets.all(16), child: Center(child: Text('စာရင်း မရှိသေးပါ — အောက်မှာ ထည့်ပါ', style: TextStyle(color: Colors.grey)))),
                for (final (i, x) in rows.indexed)
                  Card(
                    margin: const EdgeInsets.only(bottom: 6),
                    child: ListTile(
                      leading: CircleAvatar(child: Text('${x['game']}', style: const TextStyle(fontSize: 12))),
                      title: Text('${'${x['name']}'.isEmpty ? '—' : x['name']}  ·  ${x['unit_price']} Ks', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('ဖွင့် ${x['open']} · ပိတ် ${x['close']} · Draw ${x['draw']} · ဘရိတ် ${x['unit_break'] ?? 1}'),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete, color: Colors.red),
                        onPressed: () => setState(() => rows.removeAt(i)),
                      ),
                    ),
                  ),
                const Divider(height: 24),
                const Text('အသစ်ထည့်ရန်', style: TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                TextField(
                  controller: _name,
                  maxLength: 60,
                  decoration: const InputDecoration(labelText: 'အမည် (ရက်စွဲနောက်မှာ)', hintText: 'ဥပမာ AM', border: OutlineInputBorder(), isDense: true),
                ),
                Row(children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: game,
                      decoration: const InputDecoration(labelText: 'အမျိုးအစား', border: OutlineInputBorder(), isDense: true),
                      items: const [DropdownMenuItem(value: '2D', child: Text('2D LOTT')), DropdownMenuItem(value: '3D', child: Text('3D'))],
                      onChanged: (v) => setState(() => game = v ?? '2D'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _price,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'ယူနစ်စျေးနှုန်း', border: OutlineInputBorder(), isDense: true),
                    ),
                  ),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  _timeField('ဖွင့်ချိန်', open, (t) => open = t),
                  const SizedBox(width: 6),
                  _timeField('ပိတ်ချိန်', close, (t) => close = t),
                  const SizedBox(width: 6),
                  _timeField('Draw ချိန်', draw, (t) => draw = t),
                ]),
                const SizedBox(height: 10),
                TextField(
                  controller: _break,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'ဘရိတ်',
                    hintText: 'မထည့်ရင် 1 · 0 = ကန့်သတ်ချက်မရှိ',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: const Text('စာရင်းထဲ ထည့်ရန်')),
              ]),
            ),
    );
  }
}

// Picks a folder for a term (every term lives in one). Returns (picked: false) when cancelled.
Future<({bool picked, int? id})> pickFolder(BuildContext context, Object? current) async {
  final folders = await loadFolders();
  if (!context.mounted) return (picked: false, id: null);
  final picked = await showDialog<int>(
    context: context,
    builder: (ctx) => SimpleDialog(title: const Text('ဖိုင်ရွေးရန်'), children: [
      for (final f in folders)
        SimpleDialogOption(
          onPressed: () => Navigator.pop(ctx, asInt(f['id'])),
          child: Text('📁 ${f['name']}',
              style: TextStyle(fontWeight: asInt(f['id']) == asInt(current ?? 0) ? FontWeight.w800 : FontWeight.normal)),
        ),
    ]),
  );
  return picked == null ? (picked: false, id: null) : (picked: true, id: picked);
}

// အပါတ်စဥ် — terms by folder (ဖိုင်) and status, and "+ အပါတ်စဥ်အသစ်" (same defaults as the web
// dashboard's New term dialog: dd-mm-yyyy AM/PM name, 09:30/12:30 ledger, 11:59/16:00 close, 12:02/16:30 draw).
class TermsScreen extends StatefulWidget {
  const TermsScreen({super.key});

  @override
  State<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends State<TermsScreen> {
  // Draft, drawn and cancelled terms still show under "အပါတ်စဥ်အားလုံး"; they just have no item of their own.
  static const _filters = [('', 'အပါတ်စဥ်အားလုံး'), ('draft', 'Active မလုပ်ရသေး'), ('open', 'ဖွင့်ထားသောအပါတ်စဥ်များ'), ('closed', 'ပိတ်ပြီးသောအပါတ်စဥ်များ'), ('settled', 'ငွေစာရင်းရှင်းပြီး')];
  String status = '';
  int? folderId; // null = every term
  int? termId; // အပါတ်စဥ် select box: null = အပါတ်စဥ် အားလုံး (the whole list)
  List<Map<String, dynamic>> folders = [];
  List<Map<String, dynamic>> terms = []; // what the အပါတ်စဥ် box lists (the loaded rows)
  final _loader = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();
  void Function()? _stopLive;

  Map<String, dynamic>? get folder => folders.where((f) => asInt(f['id']) == folderId).firstOrNull;

  @override
  void initState() {
    super.initState();
    _stopLive = Live.instance.listen('terms', (_) => _loader.currentState?.reload());
  }

  @override
  void dispose() {
    _stopLive?.call();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final list = await loadFolders();
    if (mounted) {
      setState(() {
        folders = list;
        if (folder == null) folderId = null; // deleted elsewhere
      });
    }
    final query = [if (status.isNotEmpty) 'status=$status', if (folderId != null) 'folder_id=$folderId'].join('&');
    final rows = await Api.instance.get('/terms${query.isEmpty ? '' : '?$query'}') as List;
    final loaded = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
    if (mounted) {
      setState(() {
        terms = loaded;
        // The picked term is not in the new list (other folder / status): back to အားလုံး.
        if (!loaded.any((t) => asInt(t['id']) == termId)) termId = null;
      });
    }
    return loaded;
  }

  void _pick(int? id) {
    setState(() {
      folderId = id;
      termId = null;
    });
    _loader.currentState?.reload();
  }

  // ဖိုင် / အပါတ်စဥ် select boxes above the list (the စာရင်း screen picks the same way).
  Widget _selectBox(String label, int? value, List<DropdownMenuItem<int?>> items, ValueChanged<int?> onPick) =>
      DropdownButtonFormField<int?>(
        key: ValueKey('$label-$value-${items.length}'),
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
        items: items,
        onChanged: onPick,
      );

  // Every term lives in a folder: with none yet, make one first.
  Future<void> _create() async {
    if (folders.isEmpty) {
      snack(context, 'ဖိုင်အသစ် အရင်ဆောက်ပါ', color: Colors.orange);
      return _editFolder();
    }
    final start = folderId ?? asInt(folders.first['id']);
    final created = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => TermFormScreen(folderId: start)));
    if (created != null && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TermDetailScreen(termId: asInt(created['id']))));
      _loader.currentState?.reload();
    }
  }

  Future<void> _editFolder([Map<String, dynamic>? current]) async {
    try {
      final saved = await editFolder(context, current);
      if (saved == null || !mounted) return;
      final made = asInt(saved['auto_terms']);
      snack(context, current != null ? 'ဖိုင် သိမ်းပြီးပါပြီ' : made > 0 ? 'ဖိုင် ဖန်တီးပြီး · အပါတ်စဥ် $made ခု' : 'ဖိုင် ဖန်တီးပြီးပါပြီ');
      _pick(asInt(saved['id']));
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  // Deleting a folder erases it with its terms. Open terms block it; a folder with sales is only
  // allowed once every remaining term is settled. Then the same two choices as the web dashboard:
  // Excel backup then delete, or delete without a backup. Nothing is archived.
  Future<void> _deleteFolder(Map<String, dynamic> f) async {
    List<Map<String, dynamic>> folderTerms;
    try {
      final rows = await Api.instance.get('/terms?folder_id=${f['id']}') as List;
      folderTerms = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
    } catch (e) {
      if (mounted) errorSnack(context, e);
      return;
    }
    if (!mounted) return;
    if (folderTerms.any((t) => t['status'] == 'open')) {
      errorSnack(context, 'ဖွင့်ထားသော အပါတ်စဥ် ပါသော ဖိုင်ကို ဖျက်မရပါ');
      return;
    }
    const finished = {'settled', 'cancelled', 'draft'};
    final masterClosed = context.read<Session>().isMaster && folderTerms.every((t) => finished.contains('${t['status']}') || t['status'] == 'closed');
    if (!masterClosed && (folderTerms.any((t) => !finished.contains('${t['status']}')) ||
        folderTerms.any((t) => asInt(t['slip_count']) > 0 && t['status'] != 'settled'))) {
      errorSnack(context, 'ငွေရှင်းပြီးသော ဖိုင်များကိုသာ ဖျက်နိုင်သည်');
      return;
    }
    final mode = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ဖိုင် ဖျက်မလား?'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('📁 ${f['name']}\n\nအထဲက အပါတ်စဥ် ${asInt(f['term_count'])} ခု ပါ ပျက်ပါမည်။ ပြန်ယူ၍ မရပါ။'),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(ctx, 'backup'), child: const Text('Backup လုပ်ပြီးမှ ဖျက်မည်')),
          const SizedBox(height: 8),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, 'skip'),
            child: const Text('မလုပ်ဘဲ ဖျက်'),
          ),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ'))],
      ),
    );
    if (mode == null || !mounted) return;
    if (mode == 'backup') {
      try {
        final file = await Api.instance.getFile('/sales-data/export.xlsx?folder_id=${f['id']}');
        if (!mounted) return;
        await SharePlus.instance.share(ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(file.bytes),
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              name: file.filename,
            ),
          ],
        ));
      } catch (e) {
        if (mounted) errorSnack(context, e);
        return;
      }
      if (!mounted) return;
      final ok = await confirm(context, 'ဖိုင် ဖျက်မလား?',
          message: '📁 ${f['name']}\n\nBackup ထုတ်ပြီးပါပြီ။ အထဲက အပါတ်စဥ် ${asInt(f['term_count'])} ခု ပါ ပျက်ပါမည်။ ပြန်ယူ၍ မရပါ။',
          ok: 'ဖျက်မည်',
          danger: true);
      if (!ok || !mounted) return;
    } else {
      final ok = await confirm(context, 'မလုပ်ဘဲ ဖျက်မလား?',
          message: '📁 ${f['name']}\n\nBackup မယူပါ။ အထဲက အပါတ်စဥ် ${asInt(f['term_count'])} ခု ပါ ပျက်ပါမည်။ ပြန်ယူ၍ မရပါ။',
          ok: 'ဖျက်မည်',
          danger: true);
      if (!ok || !mounted) return;
    }
    try {
      final r = await Api.instance.delete('/term-folders/${f['id']}') as Map;
      if (!mounted) return;
      snack(context, '${f['name']} · ဖျက်ပြီး (အပါတ်စဥ် ${asInt(r['deleted_terms'])} ခု)');
      _pick(null);
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final current = folder;
    // Admin and master each run a book. A master only changes folders it owns (can_manage);
    // the shared book stays visible and is left to the admin.
    final book = session.isBook;
    final ownFolder = current != null && manages(current);
    return Scaffold(
      appBar: AppBar(
        title: Text(current == null ? 'အပါတ်စဥ်' : '📁 ${current['name']}'),
        actions: [
          if (book) IconButton(
            tooltip: 'Auto အပါတ်စဥ်',
            icon: const Icon(Icons.settings_suggest_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AutoTermsScreen())),
          ),
          if (book) IconButton(tooltip: 'ဖိုင်အသစ်', icon: const Icon(Icons.create_new_folder_outlined), onPressed: () => _editFolder()),
          if (ownFolder)
            PopupMenuButton<String>(
              onSelected: (v) => v == 'rename' ? _editFolder(current) : _deleteFolder(current),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'rename', child: Text('အမည်ပြောင်းရန်')),
                PopupMenuItem(value: 'delete', child: Text('ဖိုင် ဖျက်ရန်', style: TextStyle(color: Colors.red))),
              ],
            ),
        ],
      ),
      floatingActionButton: book && (current == null || ownFolder)
          ? FloatingActionButton.extended(
              onPressed: _create,
              icon: const Icon(Icons.add),
              label: const Text('အပါတ်စဥ်အသစ်'),
            )
          : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: Row(children: [
            Expanded(
              child: _selectBox('ဖိုင်', folderId, [
                const DropdownMenuItem(value: null, child: Text('ဖိုင် အားလုံး')),
                for (final f in folders)
                  DropdownMenuItem(value: asInt(f['id']), child: Text('📁 ${f['name']} (${f['term_count']})', overflow: TextOverflow.ellipsis)),
              ], _pick),
            ),
            const SizedBox(width: 8),
            Expanded(
              // One term on its own, or အားလုံး — the list below follows this box.
              child: _selectBox('အပါတ်စဥ် (${terms.length})', termId, [
                const DropdownMenuItem(value: null, child: Text('အပါတ်စဥ် အားလုံး')),
                for (final t in terms)
                  DropdownMenuItem(value: asInt(t['id']), child: Text('${t['description']} · ${t['game']}', overflow: TextOverflow.ellipsis)),
              ], (v) => setState(() => termId = v)),
            ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: DropdownButtonFormField<String>(
            key: ValueKey('status-$status'),
            initialValue: status,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'အခြေအနေ', border: OutlineInputBorder(), isDense: true),
            items: [
              for (final (value, label) in _filters) DropdownMenuItem(value: value, child: Text(label, overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) {
              setState(() => status = v ?? '');
              _loader.currentState?.reload();
            },
          ),
        ),
        Expanded(
          child: Loader<List<Map<String, dynamic>>>(
            key: _loader,
            load: _load,
            builder: (ctx, rows, reload) {
              final shown = termId == null ? rows : rows.where((t) => asInt(t['id']) == termId).toList();
              return shown.isEmpty
                ? EmptyView(
                    folderId == null ? 'အပါတ်စဥ် မရှိပါ' : 'ဤဖိုင်တွင် အပါတ်စဥ် မရှိပါ',
                    icon: Icons.event_busy)
                // Phones: one column; tablets / landscape: 2-3 columns of term cards.
                : AdaptiveListView(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 90),
                    itemCount: shown.length,
                    itemBuilder: (ctx, i) {
                      final t = shown[i];
                      final live = isTermOpen(t);
                      return Card(
                        elevation: 0,
                        margin: EdgeInsets.zero,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey.shade200)),
                        child: ListTile(
                          leading: GameCircle('${t['game']}'),
                          title: Row(children: [
                            Flexible(child: Text('${t['description']}', style: const TextStyle(fontWeight: FontWeight.w800), overflow: TextOverflow.ellipsis)),
                            const SizedBox(width: 6),
                            termBadge(t['status']),
                          ]),
                          subtitle: Text(
                            '#${t['id']} · ${session.money(asInt(t['unit_price']))} Ks · ပိတ် ${dateTime(t['close_at'])}${live ? '  🟢' : ''}',
                            style: const TextStyle(fontSize: 12),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TermDetailScreen(termId: asInt(t['id']))));
                            reload();
                          },
                        ),
                      );
                    },
                  );
            },
          ),
        ),
      ]),
    );
  }
}

// New / edit term. Returns the saved term. embedded: the term page's Settings tab — no app bar,
// onSaved instead of closing, and a locked (drawn / settled) term only changes its folder.
class TermFormScreen extends StatefulWidget {
  final Map<String, dynamic>? term; // null = new
  final int? folderId; // new term: the folder it starts in
  final bool embedded;
  final bool locked;
  final void Function(Map<String, dynamic> saved)? onSaved;
  const TermFormScreen({super.key, this.term, this.folderId, this.embedded = false, this.locked = false, this.onSaved});

  @override
  State<TermFormScreen> createState() => _TermFormScreenState();
}

class _TermFormScreenState extends State<TermFormScreen> {
  final _name = TextEditingController();
  final _price = TextEditingController();
  final _break = TextEditingController(text: '0'); // new term: Live Ledger break (0 = no limit)
  String game = '2D';
  DateTime? openAt, closeAt, drawAt;
  int? folderId;
  List<Map<String, dynamic>> folders = [];
  bool busy = false;
  String? error;

  bool get isNew => widget.term == null;
  // A new term goes into a folder this account owns. The current folder stays listed while editing.
  List<Map<String, dynamic>> get folderChoices => [
    for (final f in folders)
      if (manages(f) || asInt(f['id']) == folderId) f,
  ];

  @override
  void initState() {
    super.initState();
    final t = widget.term;
    folderId = t == null ? widget.folderId : (t['folder_id'] == null ? null : asInt(t['folder_id']));
    loadFolders().then((list) {
      if (mounted) setState(() => folders = list);
    }, onError: (_) {});
    if (t != null) {
      _name.text = '${t['description']}';
      _price.text = '${t['unit_price']}';
      game = '${t['game']}';
      openAt = parseDate(t['open_at']);
      closeAt = parseDate(t['close_at']);
      drawAt = parseDate(t['draw_at']);
    } else {
      final now = DateTime.now();
      final am = now.hour * 60 + now.minute < 12 * 60 + 2;
      String two(int n) => n.toString().padLeft(2, '0');
      DateTime at(int h, int m) => DateTime(now.year, now.month, now.day, h, m);
      _name.text = '${two(now.day)}-${two(now.month)}-${now.year} ${am ? 'AM' : 'PM'}';
      _price.text = '25';
      openAt = am ? at(9, 30) : at(12, 30);
      closeAt = am ? at(11, 59) : at(16, 0);
      drawAt = am ? at(12, 2) : at(16, 30);
    }
  }

  Future<void> _save() async {
    final price = int.tryParse(_price.text.trim()) ?? 0;
    if (_name.text.trim().isEmpty) return setState(() => error = 'အပါတ်စဥ် အမည် ထည့်ပါ');
    if (price <= 0) return setState(() => error = 'ယူနစ်စျေးနှုန်း ထည့်ပါ');
    if (folderId == null) return setState(() => error = 'ဖိုင် ရွေးပါ');
    final unitBreak = int.tryParse(_break.text.trim().isEmpty ? '0' : _break.text.trim());
    if (unitBreak == null || unitBreak < 0) return setState(() => error = 'ဘရိတ် ယူနစ် မှန်အောင် ထည့်ပါ');
    setState(() {
      busy = true;
      error = null;
    });
    final body = {
      'description': _name.text.trim(),
      'game': game,
      'unit_price': price,
      'open_at': isoUtc(openAt),
      'close_at': isoUtc(closeAt),
      'draw_at': isoUtc(drawAt),
      'folder_id': folderId,
    };
    try {
      final saved = Map<String, dynamic>.from(await (isNew
          ? Api.instance.post('/terms', {...body, 'status': 'open', 'unit_break': unitBreak}) // opens straight away
          : Api.instance.patch('/terms/${widget.term!['id']}', widget.locked ? {'folder_id': folderId} : body)) as Map);
      if (!mounted) return;
      if (widget.embedded) {
        snack(context, 'သိမ်းပြီးပါပြီ');
        widget.onSaved?.call(saved);
      } else {
        Navigator.pop(context, saved);
      }
    } catch (e) {
      setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true);
    final on = !widget.locked; // a locked term: only its folder can change
    final form = ContentWidth(maxWidth: 640, child: ListView(padding: const EdgeInsets.all(14), children: [
        if (widget.locked)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.amber.shade50, borderRadius: BorderRadius.circular(10)),
            child: const Text('ပေါက်သီး ထည့်ပြီးသော အပါတ်စဥ် — ဖိုင်သာ ပြောင်းနိုင်ပါသည်'),
          ),
        if (error != null)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(10)),
            child: Text(error!, style: const TextStyle(color: Colors.red)),
          ),
        TextField(controller: _name, enabled: on, decoration: deco('အပါတ်စဥ်')),
        const SizedBox(height: 12),
        // ဖိုင် (required). Rebuilt once the folder list arrives so the initial value is in the items.
        DropdownButtonFormField<int>(
          key: ValueKey(folders.length),
          initialValue: folderChoices.any((f) => asInt(f['id']) == folderId) ? folderId : null,
          decoration: deco('ဖိုင်'),
          hint: const Text('ဖိုင်ရွေးပါ'),
          items: [for (final f in folderChoices) DropdownMenuItem(value: asInt(f['id']), child: Text('📁 ${f['name']}'))],
          onChanged: (v) => setState(() => folderId = v ?? folderId),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: game,
              decoration: deco('အမျိုးအစား'),
              items: const [DropdownMenuItem(value: '2D', child: Text('2D LOTT')), DropdownMenuItem(value: '3D', child: Text('3D'))],
              onChanged: isNew ? (v) => setState(() => game = v ?? game) : null,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _price, enabled: on, keyboardType: TextInputType.number, decoration: deco('ယူနစ်စျေးနှုံး (ကျပ်)'))),
        ]),
        const SizedBox(height: 12),
        DateTimeField(label: 'လယ်ဂျာ (ထိုးကြေးဖွင့်ချိန်)', value: openAt, enabled: on, onChanged: (v) => setState(() => openAt = v)),
        const SizedBox(height: 12),
        DateTimeField(label: 'ပိတ်ချိန်', value: closeAt, enabled: on, onChanged: (v) => setState(() => closeAt = v)),
        const SizedBox(height: 12),
        DateTimeField(label: 'ဂဏန်းထွက်ချိန်', value: drawAt, enabled: on, onChanged: (v) => setState(() => drawAt = v)),
        if (isNew) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _break,
            keyboardType: TextInputType.number,
            decoration: deco('ဘရိတ် (ဂဏန်းတစ်လုံး အများဆုံး ယူနစ်၊ 0 = ကန့်သတ်ချက်မရှိ)'),
          ),
        ],
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: busy ? null : _save,
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save),
          label: Text(isNew ? 'ဖန်တီးမည်' : 'သိမ်းမည်'),
        ),
      ]));
    if (widget.embedded) return form;
    return Scaffold(appBar: AppBar(title: Text(isNew ? 'အပါတ်စဥ်အသစ်' : 'အပါတ်စဥ် ပြင်ရန်')), body: form);
  }
}
