import 'package:flutter_test/flutter_test.dart';
import 'package:online_lotto_admin/services/api.dart';
import 'package:online_lotto_admin/services/format.dart';
import 'package:online_lotto_admin/services/pattern_parser.dart';
import 'package:online_lotto_admin/services/slip_text.dart';

void main() {
  test('twod numbers: neighbours and other orderings (same rule as the server)', () {
    expect(twodNumbers('385'), ['386', '384', '358', '835', '853', '538', '583']);
    expect(twodNumbers('999'), ['000', '998']);
    expect(twodNumbers('12'), isEmpty);
  });

  test('server timestamps are UTC', () {
    expect(parseDate('2026-09-25 03:12:23')!.toUtc(), DateTime.utc(2026, 9, 25, 3, 12, 23));
    expect(parseDate('2026-09-25T06:00:00.000Z')!.toUtc(), DateTime.utc(2026, 9, 25, 6));
  });

  test('slip lines group items as typed', () {
    final ticket = {
      'groups': [
        {'id': 7, 'input': '45R', 'units': 3},
      ],
      'items': [
        {'number': '12', 'units': 5, 'group_id': null},
        {'number': '45', 'units': 3, 'group_id': 7},
        {'number': '54', 'units': 3, 'group_id': 7},
      ],
    };
    final lines = slipLines(ticket);
    expect(lines.map((l) => '${l.label}:${l.numbers.join(',')}:${l.units}'), ['12:12:5', '45R:45,54:3']);
  });

  test('server messages in Myanmar', () {
    expect(Api.translate('Insufficient balance'), 'လက်ကျန်ငွေ မလုံလောက်ပါ');
    expect(Api.translate('2D LOTT 12: your limit is 10 unit(s), 2 left'), '2D LOTT 12 — သင့်ကန့်သတ်ချက် 10 ယူနစ်၊ 2 သာ ကျန်ပါသည်');
  });

  test('POS patterns expand like the offline app', () {
    expect(parseEntry('45R', 2).numbers, ['45', '54']);
    expect(parseEntry('P', 2).numbers.length, 10);
  });
}
