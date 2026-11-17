import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:online_lotto_admin/services/report_text.dart';
import 'package:online_lotto_admin/widgets/person_filter.dart';

void main() {
  final fmt = NumberFormat('#,##0');
  String money(num v) => fmt.format(v);
  final now = DateTime(2026, 11, 7);

  test('one user: the statement an agent sends its user', () {
    final text = summaryText(
      [{'id': 5, 'username': 'aab', 'name': 'Aung Bu(az)', 'net': 2092700, 'payout': 800000}],
      company: 'Golden Lotto', title: '2-11-2026,6-11-2026', who: '', money: money, now: now,
    );
    final lines = text.split('\n');
    expect(lines.take(5), ['Golden Lotto', '2-11-2026,6-11-2026', 'User  aab (Aung Bu(az))', '7-11-2026', '----------------------']);
    expect(lines[5], allOf(startsWith('အရောင်း'), endsWith(' 2,092,700')));
    expect(lines[6], allOf(startsWith('Prize'), endsWith(' -800,000')));
    expect(lines[7], '----------------------');
    expect(lines[8], allOf(startsWith('Total'), endsWith(' 1,292,700')));
    expect(lines.length, 9);
  });

  test('an agent picked: the statement a master sends its agent', () {
    People.all = [{'id': 9, 'role': 'agent', 'username': 'zmh', 'name': 'Zaw Min'}];
    final text = summaryText(
      [
        {'id': 5, 'username': 'aab', 'name': 'Aung Bu', 'net': 2092700, 'payout': 800000},
        {'id': 6, 'username': 'ket', 'name': 'Aung Ko', 'net': 1000000, 'payout': 0},
        {'id': 7, 'username': 'kth', 'name': 'Thi Han', 'net': 38500, 'payout': 0},
      ],
      company: 'Golden Lotto', title: '2-11-2026,6-11-2026', who: 'a:9', money: money, now: now,
    );
    final lines = text.split('\n');
    expect(lines.take(6), ['Golden Lotto', '2-11-2026,6-11-2026', 'Agent  zmh (Zaw Min)', '7-11-2026', '----------------------', 'အရောင်း']);
    expect(lines[6], allOf(startsWith('aab(Aung Bu)'), endsWith(' 2,092,700')));
    expect(lines[7], allOf(startsWith('Prize'), endsWith(' -800,000')));
    expect(lines[9], allOf(startsWith('ket(Aung Ko)'), endsWith(' 1,000,000')));
    expect(lines[10], allOf(startsWith('Prize'), endsWith(' 0')));
    expect(lines.last, allOf(startsWith('Total'), endsWith(' 2,331,200'))); // 2,092,700 − 800,000 + 1,000,000 + 38,500
  });
}
