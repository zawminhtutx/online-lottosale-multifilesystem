import 'package:flutter/material.dart';

import '../services/api.dart';

// The User / Agent select box shared by စလစ်များ and the two စာရင်း views. Its value is '' (အားလုံး),
// 'u:<id>' (one user) or 'a:<id>' (every user under one agent); personQuery turns that into the
// server's user_id / agent_id filter and personLabel into a line for the ➤ shared text.
class People {
  People._();

  static List<Map<String, dynamic>> all = const [];
  static Future<void>? _loading;

  // Agents and users in scope (an agent sees only their own users), fetched once per run.
  static Future<void> load() => _loading ??= _fetch();

  static Future<void> _fetch() async {
    try {
      final rows = await Api.instance.get('/users') as List;
      all = rows.map((r) => Map<String, dynamic>.from(r as Map)).where((u) => u['role'] == 'agent' || u['role'] == 'user').toList();
    } catch (_) {
      _loading = null; // the select box stays at အားလုံး and tries again next time it is built
    }
  }
}

String personQuery(String who) => who.isEmpty ? '' : '&${who.startsWith('a:') ? 'agent_id' : 'user_id'}=${who.substring(2)}';

String? personLabel(String who) {
  if (who.isEmpty) return null;
  final id = asInt(who.substring(2));
  final u = People.all.firstWhere((p) => asInt(p['id']) == id, orElse: () => const <String, dynamic>{});
  if (u.isEmpty) return null;
  final name = '${u['name'] ?? ''}'.trim();
  return '${u['role'] == 'agent' ? 'Agent ' : ''}${u['username']}${name.isEmpty ? '' : ' ($name)'}';
}

class PersonFilter extends StatefulWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const PersonFilter({super.key, required this.value, required this.onChanged});

  @override
  State<PersonFilter> createState() => _PersonFilterState();
}

class _PersonFilterState extends State<PersonFilter> {
  @override
  void initState() {
    super.initState();
    People.load().then((_) {
      if (mounted) setState(() {});
    });
  }

  static String _name(Map<String, dynamic> u) {
    final name = '${u['name'] ?? ''}'.trim();
    return '${u['username']}${name.isEmpty ? '' : ' ($name)'}';
  }

  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
        initialValue: widget.value,
        isExpanded: true,
        decoration: const InputDecoration(isDense: true, border: OutlineInputBorder(), labelText: 'User / Agent', prefixIcon: Icon(Icons.person_outline)),
        items: [
          const DropdownMenuItem(value: '', child: Text('အားလုံး')),
          for (final a in People.all.where((u) => u['role'] == 'agent'))
            DropdownMenuItem(value: 'a:${asInt(a['id'])}', child: Text('Agent — ${_name(a)}', overflow: TextOverflow.ellipsis)),
          for (final u in People.all.where((u) => u['role'] == 'user'))
            DropdownMenuItem(value: 'u:${asInt(u['id'])}', child: Text(_name(u), overflow: TextOverflow.ellipsis)),
        ],
        onChanged: (v) => widget.onChanged(v ?? ''),
      );
}
