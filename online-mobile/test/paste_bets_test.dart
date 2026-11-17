import 'package:flutter_test/flutter_test.dart';
import 'package:online_lotto_mobile/services/pattern_parser.dart';

List<String> bets(String text, [int digits = 2]) =>
    parsePastedBets(text, digits).bets.map((b) => '${b.key}=${b.unit.toInt()}').toList();

void main() {
  test('pasted 2D lines: separators, R, several numbers, thousands, Myanmar digits', () {
    expect(bets('25 1000\n52-500\n78=200'), ['25=1000', '52=500', '78=200']);
    expect(bets('25R 500\n36r300\n47 R 100'), ['25R=500', '36R=300', '47R=100']);
    expect(bets('25/52/78 1000\n11.22-300'), ['25=1000', '52=1000', '78=1000', '11=300', '22=300']);
    expect(bets('25,52 1,000'), ['25=1000', '52=1000']);
    expect(bets('၂၅ ၁၀၀၀'), ['25=1000']);
  });

  test('pasted 3D lines', () {
    expect(bets('125 1000\n125R 500\n111-200', 3), ['125=1000', '125R=500', '111=200']);
    expect(bets('25 1000', 3).isEmpty, true);
  });

  test("this app's own shared slip text pastes back", () {
    const slip = 'Online Lotto\n14-10-2026 AM\nSlip: S3-user1-0001\n14-10-2026 07:38 AM\n'
        '----------------------\n45R - 100\n12 - 200\n----------------------\n'
        'Total:\t400';
    final r = parsePastedBets(slip, 2);
    expect(r.bets.map((b) => '${b.key}=${b.unit.toInt()}'), ['45R=100', '12=200']);
    expect(r.skipped.length, greaterThan(0));
  });

  test('lines that are not bets are skipped', () {
    final r = parsePastedBets('hello\nmin 25\n123 1000\n25 0', 2);
    expect(r.bets, isEmpty);
    expect(r.skipped, ['min 25', '123 1000', '25 0']);
  });

  test('Telegram message with R headers, 300R100 and Myanmar pattern words', () {
    const msg = 'R. 53000\n10\n90\n33\n12\nR 3100\n60\n80\nအပူး 300\n3အပါ 1500\n2ပါ 100\n1ဘရိတ် 200\n'
        '300R100\n67\n14\n1/5 အပါ 100\n2/1 ပါ 100';
    final r = parsePastedBets(msg, 2);
    expect(r.skipped, isEmpty);
    expect(r.bets.map((b) => '${b.key}=${b.unit.toInt()}'), [
      '10R=53000', '90R=53000', '33=106000', '12R=53000',
      '60R=3100', '80R=3100',
      'P=300', '3P=1500', '2P=100', '1B=200',
      '67=300', '76=100', '14=300', '41=100',
      '1P=100', '5P=100', '2P=100', '1P=100',
    ]);
  });

  test('a bare number with no header above it is a wrong line', () {
    expect(parsePastedBets('25\n36 100', 2).skipped, ['25']);
  });

  test('R300 / r200 glued headers: one R card per number, doubles twice', () {
    expect(bets('R300\n16\n10\n11\n300r100\n30\n41\nr200\n58\n17'),
        ['16R=300', '10R=300', '11=600', '30=300', '03=100', '41=300', '14=100', '58R=200', '17R=200']);
  });
}
