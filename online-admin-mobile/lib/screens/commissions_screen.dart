import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/common.dart';
import 'accounts_screen.dart' show roleNames;

// ကော်မရှင် — the commission % per bet type of the accounts the signed-in account sets (the web
// dashboard's Commission page). It is discount 1, taken off the slip price when the prize set says
// "use customer discount".
// It is handed down one step at a time (src/routes/users.js): the admin sets its masters', a master
// its own agents' and users' (with an agent filter), an agent its users'.
class CommissionsScreen extends StatefulWidget {
  const CommissionsScreen({super.key});

  @override
  State<CommissionsScreen> createState() => _CommissionsScreenState();
}

class _CommissionsScreenState extends State<CommissionsScreen> {
  List<Map<String, dynamic>>? users;
  List<Map<String, dynamic>> betTypes = const [];
  List<Map<String, dynamic>> agents = const [];
  String? error;
  String agent = ''; // '' = all, 'none' = directly under me, else agent id
  bool isAdmin = false; // sets its masters' commission: no agent filter
  bool isMaster = false; // its agents and users, filtered by agent
  String search = '';
  final _ctrls = <int, Map<int, TextEditingController>>{}; // user id -> bet type id -> %
  final _dirty = <int>{};
  final _busy = <int>{};
  bool _savingAll = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final m in _ctrls.values) {
      for (final c in m.values) {
        c.dispose();
      }
    }
    super.dispose();
  }

  static String _pct(Object? v) {
    final n = (v as num?) ?? 0;
    return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
  }

  Future<void> _load() async {
    try {
      final session = context.read<Session>();
      isAdmin = session.isAdmin;
      isMaster = session.isMaster;
      final r = await Future.wait([
        Api.instance.get('/users/commissions'),
        Api.instance.get('/meta'),
        if (isMaster) Api.instance.get('/users?role=agent'),
      ]);
      if (!mounted) return;
      final list = (r[0] as List).map((u) => Map<String, dynamic>.from(u as Map)).toList();
      final types = ((r[1] as Map)['bet_types'] as List).map((b) => Map<String, dynamic>.from(b as Map)).toList();
      setState(() {
        users = list;
        betTypes = types;
        agents = isMaster ? (r[2] as List).map((a) => Map<String, dynamic>.from(a as Map)).toList() : const [];
        error = null;
        _dirty.clear();
        for (final u in list) {
          final d = Map<String, dynamic>.from(u['discounts'] as Map? ?? const {});
          final m = _ctrls.putIfAbsent(asInt(u['id']), () => {});
          for (final bt in types) {
            final text = _pct(d['${bt['id']}']);
            (m[asInt(bt['id'])] ??= TextEditingController()).text = text;
          }
        }
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  List<Map<String, dynamic>> get _listed {
    final agentIds = agents.map((a) => asInt(a['id'])).toSet();
    final q = search.trim().toLowerCase();
    return (users ?? const []).where((u) {
      final pid = u['parent_id'] == null ? null : asInt(u['parent_id']);
      if (agent == 'none' && agentIds.contains(pid)) return false;
      if (agent != '' && agent != 'none' && '$pid' != agent) return false;
      return q.isEmpty || [u['username'], u['name'], u['name_mm']].any((s) => s != null && '$s'.toLowerCase().contains(q));
    }).toList();
  }

  List<Map<String, Object>> _payload(Iterable<int> userIds) => [
        for (final id in userIds)
          for (final bt in betTypes)
            {
              'user_id': id,
              'bet_type_id': asInt(bt['id']),
              'discount': (double.tryParse(_ctrls[id]![asInt(bt['id'])]!.text.trim()) ?? 0).clamp(0, 100),
            },
      ];

  Future<void> _save(Map<String, dynamic> u) async {
    final id = asInt(u['id']);
    setState(() => _busy.add(id));
    try {
      await Api.instance.put('/users/commissions', _payload([id]));
      if (!mounted) return;
      setState(() => _dirty.remove(id));
      snack(context, '${u['username']} ကော်မရှင် သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _saveAll() async {
    final ids = _dirty.toList();
    if (ids.isEmpty) return;
    setState(() => _savingAll = true);
    try {
      await Api.instance.put('/users/commissions', _payload(ids));
      if (!mounted) return;
      setState(() => _dirty.removeAll(ids));
      snack(context, '${ids.length} ဦး ကော်မရှင် သိမ်းပြီးပါပြီ');
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _savingAll = false);
    }
  }

  // One % per bet type for every listed user (blank = leave that bet type alone), then save.
  Future<void> _setAll() async {
    final listed = _listed;
    if (listed.isEmpty) return;
    final ctrls = {for (final bt in betTypes) asInt(bt['id']): TextEditingController()};
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('ပြထားသော ${listed.length} ဦးလုံး'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final bt in betTypes)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: TextField(
                controller: ctrls[asInt(bt['id'])],
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                decoration: InputDecoration(labelText: '${bt['code']} ကော်မရှင် %', hintText: 'မဖြည့်ရင် မပြောင်းပါ', border: const OutlineInputBorder()),
              ),
            ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('သိမ်းမည်')),
        ],
      ),
    );
    final values = {for (final e in ctrls.entries) e.key: e.value.text.trim()};
    for (final c in ctrls.values) {
      c.dispose();
    }
    if (go != true || values.values.every((v) => v.isEmpty)) return;
    setState(() {
      for (final u in listed) {
        final id = asInt(u['id']);
        values.forEach((bt, v) {
          if (v.isNotEmpty) _ctrls[id]![bt]!.text = v;
        });
        _dirty.add(id);
      }
    });
    await _saveAll();
  }

  @override
  Widget build(BuildContext context) {
    final listed = _listed;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ကော်မရှင်'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          IconButton(icon: const Icon(Icons.done_all), tooltip: 'အားလုံး သတ်မှတ်', onPressed: users == null ? null : _setAll),
        ],
      ),
      floatingActionButton: _dirty.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: _savingAll ? null : _saveAll,
              icon: _savingAll
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save),
              label: Text('သိမ်းမည် (${_dirty.length})'),
            ),
      body: users == null
          ? (error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
                child: Row(children: [
                  Expanded(
                    child: TextField(
                      decoration: const InputDecoration(isDense: true, prefixIcon: Icon(Icons.search), hintText: 'ရှာရန်', border: OutlineInputBorder()),
                      onChanged: (v) => setState(() => search = v),
                    ),
                  ),
                  if (isMaster) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: agent,
                        isExpanded: true,
                        decoration: const InputDecoration(isDense: true, border: OutlineInputBorder()),
                        items: [
                          const DropdownMenuItem(value: '', child: Text('Agent အားလုံး')),
                          const DropdownMenuItem(value: 'none', child: Text('ကျွန်ုပ်အောက် တိုက်ရိုက်')),
                          for (final a in agents) DropdownMenuItem(value: '${a['id']}', child: Text('${a['username']}', overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: (v) => setState(() => agent = v ?? ''),
                      ),
                    ),
                  ],
                ]),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                    isAdmin
                        ? 'Master ${listed.length} ဦး · % ပြင်ပြီး 💾 နှိပ်ပါ — Master က သူ့အောက်ရှိ Agent / User များကို တဆင့်ပြန် သတ်မှတ်ပါမည်'
                        : '${listed.length} ဦး · % ပြင်ပြီး 💾 နှိပ်ပါ',
                    style: TextStyle(fontSize: 12, color: Colors.grey[600])),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: _load,
                  child: listed.isEmpty
                      ? EmptyView(isAdmin ? 'Master မရှိပါ' : 'အကောင့် မရှိပါ')
                      : AdaptiveListView(
                          padding: const EdgeInsets.fromLTRB(10, 8, 10, 90),
                          spacing: 0,
                          itemCount: listed.length,
                          itemBuilder: (ctx, i) => _card(listed[i]),
                        ),
                ),
              ),
            ]),
    );
  }

  Widget _card(Map<String, dynamic> u) {
    final id = asInt(u['id']);
    final dirty = _dirty.contains(id);
    final busy = _busy.contains(id);
    return SectionCard(children: [
      Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(
                  child: Text('${u['username']}',
                      overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15.5))),
              if (!isAdmin && u['role'] != null) ...[
                const SizedBox(width: 6),
                StatusChip(roleNames['${u['role']}'] ?? '${u['role']}',
                    u['role'] == 'agent' ? const Color(0xFFEA580C) : const Color(0xFF0EA5E9)),
              ],
            ]),
            Text([u['name'], if (u['parent_username'] != null) 'အထက်: ${u['parent_username']}'].join(' · '),
                style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
          ]),
        ),
        if (u['status'] != 'active') StatusChip('${u['status']}', Colors.grey),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        for (final bt in betTypes) ...[
          Expanded(
            child: TextField(
              controller: _ctrls[id]![asInt(bt['id'])],
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              textAlign: TextAlign.right,
              decoration: InputDecoration(isDense: true, labelText: '${bt['code']}', suffixText: '%', border: const OutlineInputBorder()),
              onChanged: (_) => setState(() => _dirty.add(id)),
            ),
          ),
          const SizedBox(width: 8),
        ],
        IconButton.filled(
          tooltip: 'သိမ်းမည်',
          onPressed: dirty && !busy ? () => _save(u) : null,
          icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save),
        ),
      ]),
    ]);
  }
}
