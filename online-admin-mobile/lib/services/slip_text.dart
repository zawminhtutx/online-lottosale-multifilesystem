import 'api.dart';
import 'format.dart';
import 'pattern_parser.dart';

// A saved slip's lines grouped as typed ("45R" is one line), from a GET/POST /tickets result.
List<({String label, List<String> numbers, int units, List<Map> items})> slipLines(Map ticket) {
  final groups = <int, ({String label, List<String> numbers, int units, List<Map> items})>{};
  final lines = <({String label, List<String> numbers, int units, List<Map> items})>[];
  for (final g in (ticket['groups'] as List? ?? const [])) {
    final m = g as Map;
    groups[asInt(m['id'])] = (label: '${m['input']}', numbers: <String>[], units: asInt(m['units']), items: <Map>[]);
  }
  for (final raw in (ticket['items'] as List? ?? const [])) {
    final item = raw as Map;
    final gid = item['group_id'];
    final group = gid == null ? null : groups[asInt(gid)];
    if (group != null) {
      if (group.numbers.isEmpty) lines.add(group);
      group.numbers.add('${item['number']}');
      group.items.add(item);
    } else {
      lines.add((label: '${item['number']}', numbers: ['${item['number']}'], units: asInt(item['units']), items: [item]));
    }
  }
  return lines;
}

// Server slip_no already carries who typed it (S-/A-/M-/G-…). Do not wrap it in S{termId}-.
String displaySlipNo(Map ticket) => '${ticket['slip_no'] ?? ''}';

// Plain-text slip for Send (SMS / Viber / Telegram ... through the share sheet).
String slipText(Map ticket, {Map? term, required String Function(num) money}) {
  final termName = term?['description'] ?? ticket['term_description'] ?? '';
  final b = StringBuffer()
    ..writeln('Online Lotto')
    ..writeln('$termName')
    ..writeln('Slip: ${displaySlipNo(ticket)}')
    ..writeln(dateTime(ticket['created_at']))
    ..writeln('----------------------');
  for (final l in slipLines(ticket)) {
    final label = l.numbers.length > 1 ? '${patternLabel(l.label)} (${l.numbers.length})' : l.label;
    b.writeln('$label - ${l.units}');
  }
  b.writeln('----------------------');
  b.writeln('စုစုပေါင်း: ${money(asInt(ticket['gross_amount']))} Ks');
  if (asInt(ticket['discount_amount']) > 0) b.writeln('ကော်မရှင်: -${money(asInt(ticket['discount_amount']))} Ks');
  b.writeln('ပေးချေရန်: ${money(asInt(ticket['net_amount']))} Ks');
  if (asInt(ticket['win_amount']) > 0) b.writeln('ဆုငွေ: ${money(asInt(ticket['win_amount']))} Ks');
  return b.toString();
}
