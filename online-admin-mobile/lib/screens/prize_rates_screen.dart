import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api.dart';
import '../widgets/common.dart';

// အလျော်အဆ — payout multiplier per prize set / bet type (web Prize rates). Admin only.
class PrizeRatesScreen extends StatefulWidget {
  const PrizeRatesScreen({super.key});

  @override
  State<PrizeRatesScreen> createState() => _PrizeRatesScreenState();
}

class _PrizeRatesScreenState extends State<PrizeRatesScreen> {
  List<Map<String, dynamic>>? sets;
  List<Map<String, dynamic>> betTypes = const [];
  String? error;
  final _mult = <int, Map<int, TextEditingController>>{};
  final _twod = <int, TextEditingController>{};
  final _dirty = <int>{};
  final _busy = <int>{};

  bool get _hasThreeD => betTypes.any((b) => b['code'] == '3D');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final m in _mult.values) {
      for (final c in m.values) {
        c.dispose();
      }
    }
    for (final c in _twod.values) {
      c.dispose();
    }
    super.dispose();
  }

  int _multiplier(Map<String, dynamic> set, int btId) {
    for (final r in (set['rates'] as List? ?? const [])) {
      if (asInt(r['bet_type_id']) == btId) return asInt(r['multiplier']);
    }
    return 0;
  }

  num _discount(Map<String, dynamic> set, int btId) {
    for (final r in (set['rates'] as List? ?? const [])) {
      if (asInt(r['bet_type_id']) == btId) {
        final v = r['discount'];
        return v is num ? v : num.tryParse('$v') ?? -1;
      }
    }
    return -1;
  }

  Future<void> _load() async {
    try {
      final r = await Future.wait([Api.instance.get('/prize-sets'), Api.instance.get('/meta')]);
      if (!mounted) return;
      final list = (r[0] as List).map((s) => Map<String, dynamic>.from(s as Map)).toList();
      final types = ((r[1] as Map)['bet_types'] as List).map((b) => Map<String, dynamic>.from(b as Map)).toList();
      setState(() {
        sets = list;
        betTypes = types;
        error = null;
        _dirty.clear();
        for (final set in list) {
          final id = asInt(set['id']);
          final m = _mult.putIfAbsent(id, () => {});
          for (final bt in types) {
            final text = '${_multiplier(set, asInt(bt['id']))}';
            (m[asInt(bt['id'])] ??= TextEditingController()).text = text;
          }
          (_twod[id] ??= TextEditingController()).text = '${asInt(set['twod_multiplier'])}';
        }
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  List<Map<String, dynamic>> _ratesPayload(Map<String, dynamic> set) {
    final id = asInt(set['id']);
    return [
      for (final bt in betTypes)
        {
          'bet_type_id': asInt(bt['id']),
          'multiplier': int.tryParse(_mult[id]![asInt(bt['id'])]!.text.trim()) ?? 0,
          'discount': _discount(set, asInt(bt['id'])),
        },
    ];
  }

  Future<void> _save(Map<String, dynamic> set) async {
    final id = asInt(set['id']);
    setState(() => _busy.add(id));
    try {
      await Api.instance.put('/prize-sets/$id/rates', _ratesPayload(set));
      if (_hasThreeD) {
        await Api.instance.patch('/prize-sets/$id', {'twod_multiplier': int.tryParse(_twod[id]!.text.trim()) ?? 0});
      }
      if (!mounted) return;
      setState(() => _dirty.remove(id));
      snack(context, '${set['name']} သိမ်းပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _rename(Map<String, dynamic> set) async {
    final ctrl = TextEditingController(text: '${set['name']}');
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('အမည် ပြင်မည်'),
        content: TextField(controller: ctrl, autofocus: true, decoration: const InputDecoration(labelText: 'အမည်', border: OutlineInputBorder())),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('သိမ်းမည်')),
        ],
      ),
    );
    final name = ctrl.text.trim();
    ctrl.dispose();
    if (go != true || name.isEmpty) return;
    try {
      await Api.instance.patch('/prize-sets/${set['id']}', {'name': name});
      if (mounted) snack(context, 'အမည် ပြင်ပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _delete(Map<String, dynamic> set) async {
    if (asInt(set['id']) == 0) return;
    if (!await confirm(context, '"${set['name']}" ဖျက်မလား?', ok: 'ဖျက်မည်', danger: true)) return;
    try {
      await Api.instance.delete('/prize-sets/${set['id']}');
      if (mounted) snack(context, 'အဆ ဖျက်ပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _create() async {
    Map<String, dynamic>? template;
    for (final s in sets ?? const <Map<String, dynamic>>[]) {
      if (asInt(s['id']) == 0) {
        template = s;
        break;
      }
    }
    template ??= sets?.isNotEmpty == true ? sets!.first : null;
    final nameCtrl = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('အလျော်အဆ အသစ်'),
        content: TextField(
          controller: nameCtrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'အမည်', hintText: 'ဥပမာ VIP', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ဖန်တီးမည်')),
        ],
      ),
    );
    final name = nameCtrl.text.trim();
    nameCtrl.dispose();
    if (go != true || name.isEmpty) return;
    try {
      final body = <String, dynamic>{'name': name};
      if (template != null) body['copy_from'] = asInt(template['id']);
      await Api.instance.post('/prize-sets', body);
      if (mounted) snack(context, '$name ဖန်တီးပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('အလျော်အဆ'), actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)]),
      floatingActionButton: FloatingActionButton.extended(onPressed: sets == null ? null : _create, icon: const Icon(Icons.add), label: const Text('အဆ အသစ်')),
      body: sets == null
          ? (error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: sets!.isEmpty
                  ? const EmptyView('အလျော်အဆ မရှိသေးပါ')
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 10, 12, 88),
                      itemCount: sets!.length,
                      itemBuilder: (ctx, i) {
                        final set = sets![i];
                        final id = asInt(set['id']);
                        final busy = _busy.contains(id);
                        return SectionCard(
                          title: '${set['name']}${id == 0 ? '  ·  Default' : ''}',
                          trailing: Text('${asInt(set['user_count'])} အကောင့်', style: TextStyle(color: Colors.grey[600], fontSize: 12.5)),
                          children: [
                            Wrap(
                              spacing: 10,
                              runSpacing: 10,
                              children: [
                                for (final bt in betTypes)
                                  SizedBox(
                                    width: 110,
                                    child: TextField(
                                      controller: _mult[id]![asInt(bt['id'])],
                                      keyboardType: TextInputType.number,
                                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                      onChanged: (_) => setState(() => _dirty.add(id)),
                                      decoration: InputDecoration(
                                        labelText: '${bt['code']} ×',
                                        isDense: true,
                                        border: const OutlineInputBorder(),
                                      ),
                                    ),
                                  ),
                                if (_hasThreeD)
                                  SizedBox(
                                    width: 110,
                                    child: TextField(
                                      controller: _twod[id],
                                      keyboardType: TextInputType.number,
                                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                      onChanged: (_) => setState(() => _dirty.add(id)),
                                      decoration: const InputDecoration(labelText: 'တွဒ် ×', isDense: true, border: OutlineInputBorder()),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Row(children: [
                              IconButton(tooltip: 'အမည် ပြင်ရန်', onPressed: () => _rename(set), icon: const Icon(Icons.edit_outlined)),
                              IconButton(
                                tooltip: id == 0 ? 'Default ကို ဖျက်မရပါ' : 'ဖျက်ရန်',
                                onPressed: id == 0 ? null : () => _delete(set),
                                icon: const Icon(Icons.delete_outline),
                              ),
                              const Spacer(),
                              FilledButton.icon(
                                onPressed: !_dirty.contains(id) || busy ? null : () => _save(set),
                                icon: busy
                                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                    : const Icon(Icons.save_outlined, size: 18),
                                label: const Text('သိမ်းမည်'),
                              ),
                            ]),
                          ],
                        );
                      },
                    ),
            ),
    );
  }
}
