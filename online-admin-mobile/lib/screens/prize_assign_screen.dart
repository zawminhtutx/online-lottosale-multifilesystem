import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// အလျော်အဆတွဲ — admin-made prize sets, given only to users (bettors).
class PrizeAssignScreen extends StatefulWidget {
  const PrizeAssignScreen({super.key});

  @override
  State<PrizeAssignScreen> createState() => _PrizeAssignScreenState();
}

class _PrizeAssignScreenState extends State<PrizeAssignScreen> {
  List<Map<String, dynamic>> accounts = const [];
  List<Map<String, dynamic>> sets = const [];
  List<Map<String, dynamic>> betTypes = const [];
  String? error;
  bool loading = true;
  String search = '';
  final _busy = <int>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final r = await Future.wait([
        Api.instance.get('/users?role=user'),
        Api.instance.get('/prize-sets'),
        Api.instance.get('/meta'),
      ]);
      if (!mounted) return;
      setState(() {
        accounts = (r[0] as List).map((u) => Map<String, dynamic>.from(u as Map)).toList();
        sets = (r[1] as List).map((s) => Map<String, dynamic>.from(s as Map)).toList();
        betTypes = ((r[2] as Map)['bet_types'] as List).map((b) => Map<String, dynamic>.from(b as Map)).toList();
        error = null;
        loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { error = '$e'; loading = false; });
    }
  }

  bool get _hasThreeD => betTypes.any((b) => b['code'] == '3D');

  int _multiplier(Map<String, dynamic> s, int btId) {
    for (final r in (s['rates'] as List? ?? const [])) {
      if (asInt(r['bet_type_id']) == btId) return asInt(r['multiplier']);
    }
    return 0;
  }

  String _setLabel(Map<String, dynamic> s) {
    final bits = [
      for (final bt in betTypes) '${bt['code']}×${_multiplier(s, asInt(bt['id']))}',
      if (_hasThreeD) 'တွဒ်×${asInt(s['twod_multiplier'])}',
    ];
    return '${s['name']}  (${bits.join(' ')})';
  }

  List<Map<String, dynamic>> get _people {
    final me = context.read<Session>();
    final q = search.trim().toLowerCase();
    return accounts.where((u) {
      if (u['role'] != 'user' || asInt(u['id']) == me.id) return false;
      if (q.isEmpty) return true;
      return [u['username'], u['name'], u['phone']].any((v) => v != null && '$v'.toLowerCase().contains(q));
    }).toList();
  }

  Future<void> _assign(Map<String, dynamic> u, int setId) async {
    final id = asInt(u['id']);
    setState(() => _busy.add(id));
    try {
      await Api.instance.patch('/users/$id', {'prize_set_id': setId});
      u['prize_set_id'] = setId;
      if (mounted) {
        setState(() {});
        snack(context, '${u['username']} အဆ ပြောင်းပြီးပါပြီ');
      }
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final people = _people;
    return Scaffold(
      appBar: AppBar(title: const Text('အလျော်အဆတွဲ'), actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'အမည် / Username / ဖုန်း', isDense: true, border: OutlineInputBorder()),
            onChanged: (v) => setState(() => search = v),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text('${people.length} အကောင့်  ·  ${sets.length} အဆ', style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
          ),
        ),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : error != null
                  ? ErrorView(message: error!, onRetry: _load)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: people.isEmpty
                          ? EmptyView(search.isEmpty ? 'အကောင့် မရှိသေးပါ' : 'မတွေ့ပါ')
                          : ListView.builder(
                              padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                              itemCount: people.length,
                              itemBuilder: (ctx, i) {
                                final u = people[i];
                                final current = asInt(u['prize_set_id']);
                                final options = [
                                  if (!sets.any((s) => asInt(s['id']) == current)) {'id': current, 'name': '#$current', 'rates': const []},
                                  ...sets,
                                ];
                                return SectionCard(children: [
                                  Row(children: [
                                    Expanded(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text('${u['username']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5)),
                                        Text(
                                          [
                                            if ('${u['name'] ?? ''}'.isNotEmpty) '${u['name']}',
                                            if (u['parent_username'] != null && asInt(u['parent_id']) != session.id) '@${u['parent_username']}',
                                          ].join('  ·  '),
                                          style: TextStyle(color: Colors.grey[600], fontSize: 12.5),
                                        ),
                                      ]),
                                    ),
                                  ]),
                                  const SizedBox(height: 8),
                                  DropdownButtonFormField<int>(
                                    key: ValueKey('${u['id']}-$current'),
                                    initialValue: options.any((s) => asInt(s['id']) == current) ? current : null,
                                    isExpanded: true,
                                    decoration: const InputDecoration(labelText: 'အလျော်အဆ', border: OutlineInputBorder(), isDense: true),
                                    items: [
                                      for (final s in options)
                                        DropdownMenuItem(value: asInt(s['id']), child: Text(_setLabel(s), overflow: TextOverflow.ellipsis)),
                                    ],
                                    onChanged: _busy.contains(asInt(u['id']))
                                        ? null
                                        : (v) {
                                            if (v != null) _assign(u, v);
                                          },
                                  ),
                                ]);
                              },
                            ),
                    ),
        ),
      ]),
    );
  }
}
