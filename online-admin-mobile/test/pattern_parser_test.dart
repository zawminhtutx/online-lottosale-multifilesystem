// The ADD HOT dialog expands patterns with the sale screens' parser.
import 'package:flutter_test/flutter_test.dart';
import 'package:online_lotto_admin/services/pattern_parser.dart';

void main() {
  test('2D patterns used by ADD HOT', () {
    expect(parseEntry('12R', 2).numbers, ['12', '21']);
    expect(parseEntry('2*', 2).numbers, ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']);
    expect(parseEntry('*2', 2).numbers, ['02', '12', '22', '32', '42', '52', '62', '72', '82', '92']);
    expect(parseEntry('45', 2).numbers, ['45']);
    expect(parseEntry('145A', 2).numbers, ['14', '41', '15', '51', '45', '54', '11', '44', '55']);
    expect(parseEntry('145-', 2).numbers, ['14', '41', '15', '51', '45', '54']);
    expect(parseEntry('112A', 2).ok, isFalse);
    expect(parseEntry('145A', 3).ok, isFalse);
    expect(parseEntry('7', 2).ok, isFalse);
  });

  test('ungroup keeps stored numbers instead of dropping the group', () {
    final stored = ['14', '41', '15', '51', '45', '54', '11', '44', '55'];
    expect(splitGroupNumbers('145', stored, 2), stored);
    expect(splitGroupNumbers('145', [], 2), stored);
    expect(splitGroupNumbers('145-', [], 2), ['14', '41', '15', '51', '45', '54']);
    expect(splitGroupNumbers('12R', ['12', '21'], 2), ['12', '21']);
  });

  test('3D patterns used by ADD HOT', () {
    expect(parseEntry('12*', 3).numbers.first, '120');
    expect(parseEntry('*12', 3).numbers.last, '912');
    expect(parseEntry('1*2', 3).numbers.length, 10);
    expect(parseEntry('123R', 3).numbers.length, 6);
  });
}
