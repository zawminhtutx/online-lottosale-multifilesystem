import 'api.dart';
import 'company.dart';
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

// Plain-text slip for Send (SMS / Viber / Telegram ... through the share sheet). header: the slip
// heading — the phone's own (printer settings) or else the company name (Company.slipHeader).
String slipText(Map ticket, {Map? term, String? header, required String Function(num) money}) {
  final termName = term?['description'] ?? ticket['term_description'] ?? '';
  final termId = ticket['term_id'];
  final b = StringBuffer()
    ..writeln(header ?? Company.slipHeader())
    ..writeln('$termName')
    ..writeln('Slip: S$termId-${ticket['slip_no']}')
    ..writeln(dateTime(ticket['created_at']))
    ..writeln('----------------------');
  for (final l in slipLines(ticket)) {
    final label = l.numbers.length > 1 ? '${patternLabel(l.label)} (${l.numbers.length})' : l.label;
    b.writeln('$label - ${l.units}');
  }
  b.writeln('----------------------');
  b.writeln('Total:\t${money(asInt(ticket['gross_amount']))}');
  return b.toString();
}
