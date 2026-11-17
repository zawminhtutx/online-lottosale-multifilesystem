import 'package:intl/intl.dart';

import '../widgets/person_filter.dart';
import 'api.dart';

// ➤ စာရင်း ပို့ရန်: the summary rows as plain text for Viber, Telegram, SMS … Two layouts:
//
//  One user (the statement an agent sends its user):
//    Company Name
//    2-11-2026,6-11-2026
//    User  aab (Aung Bu)
//    7-11-2026
//    ----------------------
//    အရောင်း       2,092,700
//    Prize          -800,000
//    ----------------------
//    Total        1,292,700
//
//  Several accounts (the statement a master sends its agent: that agent's users, one block each):
//    Company Name
//    2-11-2026,6-11-2026
//    Agent  zmh (Zaw Min)
//    7-11-2026
//    ----------------------
//    အရောင်း
//    aab(Aung Bu)    2,092,700
//    Prize            -800,000
//
//    ket(Aung Ko)    1,000,000
//    Prize                   0
//    ----------------------
//    Total        2,292,700
//
// အရောင်း is the net sales (after commission), Prize the winnings paid (shown negative) and Total
// their difference — what the account pays (+) or is paid (−).

// The company heading, from the server (set by the admin on the Profile screen), cached per run.
class Company {
  Company._();
  static String? _name;

  static Future<String> name() async {
    if (_name != null) return _name!;
    try {
      final r = await Api.instance.get('/settings/company') as Map;
      _name = '${r['company_name'] ?? ''}'.trim();
    } catch (_) {
      return 'Online Lotto';
    }
    return _name!.isEmpty ? 'Online Lotto' : _name!;
  }

  static void set(String name) => _name = name.trim();
}

const _rule = '----------------------';
const _width = 26; // characters per line the amounts are right-aligned to

String _line(String left, String right) {
  final gap = _width - left.length - right.length;
  return '$left${' ' * (gap < 2 ? 2 : gap)}$right';
}

String _account(Map u, {bool spaced = true}) {
  final name = '${u['name'] ?? ''}'.trim();
  return '${u['username']}${name.isEmpty ? '' : spaced ? ' ($name)' : '($name)'}';
}

// title: the term (or ဖိုင်) the figures are for. who: the User / Agent select box's value
// (see PersonFilter) — an agent picked heads the text with that agent.
String summaryText(
  List<Map<String, dynamic>> rows, {
  required String company,
  required String title,
  required String who,
  required String Function(num) money,
  DateTime? now,
}) {
  final picked = who.isEmpty
      ? const <String, dynamic>{}
      : People.all.firstWhere((p) => asInt(p['id']) == asInt(who.substring(2)), orElse: () => const <String, dynamic>{});
  final oneUser = rows.length == 1 && !who.startsWith('a:');
  final b = StringBuffer()
    ..writeln(company)
    ..writeln(title);
  if (oneUser) {
    b.writeln('User  ${_account(rows.first)}');
  } else if (picked.isNotEmpty) {
    b.writeln('${picked['role'] == 'agent' ? 'Agent' : 'User'}  ${_account(picked)}');
  }
  b
    ..writeln(DateFormat('d-M-yyyy').format(now ?? DateTime.now()))
    ..writeln(_rule);

  var total = 0;
  if (oneUser) {
    final r = rows.first;
    b
      ..writeln(_line('အရောင်း', money(asInt(r['net']))))
      ..writeln(_line('Prize', money(-asInt(r['payout']))));
    total = asInt(r['net']) - asInt(r['payout']);
  } else {
    b.writeln('အရောင်း');
    for (final r in rows) {
      b
        ..writeln(_line(_account(r, spaced: false), money(asInt(r['net']))))
        ..writeln(_line('Prize', money(-asInt(r['payout']))))
        ..writeln();
      total += asInt(r['net']) - asInt(r['payout']);
    }
  }
  b
    ..writeln(_rule)
    ..write(_line('Total', money(total)));
  return b.toString();
}
