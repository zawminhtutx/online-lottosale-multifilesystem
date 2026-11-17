// Dart port of the desktop client's pattern parser (client/src/pages/SalePage.jsx parseEntry
// + uniquePermutations) and its Burmese pattern labels (client/src/patterns.js) — kept in sync
// with those so a pattern like "45R" or "1P" means exactly the same thing and expands to the
// same numbers on mobile as it does on the desktop POS.

class ParsedPattern {
  final List<String> numbers;
  final int? grouptype;
  final String? error;
  const ParsedPattern({this.numbers = const [], this.grouptype, this.error});
  bool get ok => error == null;
}

/// All unique permutations of a digit string, deduped (a repeated digit collapses duplicate
/// permutations) — e.g. "112" -> ["112","121","211"].
List<String> uniquePermutations(String s) {
  final results = <String>{};
  void permute(String remaining, String prefix) {
    if (remaining.isEmpty) {
      results.add(prefix);
      return;
    }
    for (var i = 0; i < remaining.length; i++) {
      permute(remaining.substring(0, i) + remaining.substring(i + 1), prefix + remaining[i]);
    }
  }

  permute(s, '');
  return results.toList();
}

const Map<String, String> _patternLabels = {
  'W': 'ပါဝါ',
  'SP': 'စုံပူး',
  'MP': 'မပူး',
  'SM': 'စုံမ',
  'MM': 'မမ',
  'MS': 'မစုံ',
  'SS': 'စုံစုံ',
  'P': 'အပူး',
  'K': 'နက္ခက်',
  'N': 'ညီကို',
  'T': 'ထွိုင်',
};

/// Myanmar display name for a pattern key — same wording as the desktop's Sale table and
/// printed slip (client/src/patterns.js). R/RR and the *-wildcards have no conventional name
/// in this business's usage, so they're shown as-is.
String patternLabel(String? key) {
  if (key == null || key.isEmpty) return key ?? '';
  final direct = _patternLabels[key];
  if (direct != null) return direct;
  if (RegExp(r'^\d{3,}A$').hasMatch(key)) return key.substring(0, key.length - 1);
  var m = RegExp(r'^(\d+)P$').firstMatch(key);
  if (m != null) return '${m[1]}အပါ';
  m = RegExp(r'^(\d+)S$').firstMatch(key);
  if (m != null) return '${m[1]}စုံ';
  m = RegExp(r'^(\d+)M$').firstMatch(key);
  if (m != null) return '${m[1]}မ';
  m = RegExp(r'^(\d+)B$').firstMatch(key);
  if (m != null) return '${m[1]} ဘရိတ်';
  return key;
}

/// Collapses saledetail-shaped rows ('number'/'unit'/'groupkey') for one sale back into one row
/// per original pattern entry — the same collapsing bet_screen.dart's own cart already represents
/// before it's expanded into individual saledetail rows, and how the desktop web app displays and
/// prints a sale. Rows with no groupkey (a plain single number) pass through unchanged; consecutive
/// rows sharing the same non-empty groupkey and unit collapse into one row showing that pattern's
/// label instead of every number it expanded to. Relies on rows staying in original insertion
/// order (see slips_screen.dart's _details: `orderBy: 'id'`, and bet_screen.dart's per-entry
/// insert loop, which always inserts one pattern's rows contiguously).
List<Map<String, Object?>> groupedSaleItems(List<Map<String, Object?>> items) {
  final result = <Map<String, Object?>>[];
  var i = 0;
  while (i < items.length) {
    final gk = (items[i]['groupkey'] as String?) ?? '';
    final unit = items[i]['unit'];
    if (gk.isEmpty) {
      result.add({'number': items[i]['number'], 'unit': unit});
      i++;
      continue;
    }
    var j = i + 1;
    while (j < items.length && ((items[j]['groupkey'] as String?) ?? '') == gk && items[j]['unit'] == unit) {
      j++;
    }
    result.add({'number': patternLabel(gk), 'unit': unit});
    i = j;
  }
  return result;
}

/// Expands a raw typed pattern (e.g. "45", "45R", "45RR", "12*", "*12", "1*2", "W", "1P") into
/// its list of individual bet numbers plus a grouptype code (null for a single plain number).
bool hasRepeatDigits(String digitStr) {
  final d = digitStr.replaceAll(RegExp(r'\D'), '');
  return d.isNotEmpty && d.split('').toSet().length != d.length;
}

/// 2D အပြီးပေါက်: "145" -> 14R, 15R, 45R, then (if withDoubles) 11, 44, 55.
({List<String> codes, List<String> numbers}) expandApayePauk(String digitStr, {bool withDoubles = true}) {
  if (hasRepeatDigits(digitStr)) return (codes: <String>[], numbers: <String>[]);
  final chars = digitStr.split('');
  final codes = <String>[];
  void combine(int start, List<int> chosen) {
    if (chosen.length == 2) {
      codes.add('${chosen.map((i) => chars[i]).join()}R');
      return;
    }
    for (var i = start; i < chars.length; i++) {
      combine(i + 1, [...chosen, i]);
    }
  }

  combine(0, []);
  if (withDoubles) {
    final seen = <String>{};
    for (final c in chars) {
      if (seen.add(c)) codes.add('$c$c');
    }
  }
  final uniqueCodes = <String>[];
  final seenCodes = <String>{};
  for (final code in codes) {
    if (seenCodes.add(code)) uniqueCodes.add(code);
  }
  final numbers = <String>[];
  final seenNums = <String>{};
  for (final code in uniqueCodes) {
    final parts = code.endsWith('R') ? uniquePermutations(code.substring(0, code.length - 1)) : [code];
    for (final n in parts) {
      if (seenNums.add(n)) numbers.add(n);
    }
  }
  return (codes: uniqueCodes, numbers: numbers);
}

List<String> splitGroupNumbers(String input, List<String> stored, int digits) {
  final rawStored = stored.map((n) => n.trim()).where((n) => n.isNotEmpty).toList();
  final fromStore = rawStored.where((n) => RegExp(r'^\d+$').hasMatch(n)).toList();
  if (fromStore.length > 1) return fromStore;
  final ap = RegExp(r'^(\d{3,})(A|-)?$').firstMatch(input.trim());
  if (digits == 2 && ap != null && !hasRepeatDigits(ap.group(1)!)) {
    final expanded = expandApayePauk(ap.group(1)!, withDoubles: ap.group(2) != '-');
    if (expanded.numbers.length > 1) return expanded.numbers;
  }
  final parsed = parseEntry(input.trim(), digits);
  if (parsed.ok && parsed.numbers.length > 1) return parsed.numbers;
  if (rawStored.length > 1) return rawStored;
  return fromStore;
}

ParsedPattern parseEntry(String raw, int digits) {
  final apaye = RegExp(r'^(\d{3,})(A|-)?$').firstMatch(raw);
  if (apaye != null && (apaye.group(2) ?? '').isNotEmpty) {
    if (digits != 2) return const ParsedPattern(error: 'အပြီးခွေ ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    if (hasRepeatDigits(apaye.group(1)!)) return const ParsedPattern(error: 'ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ');
    final expanded = expandApayePauk(apaye.group(1)!, withDoubles: apaye.group(2) != '-');
    if (expanded.numbers.isEmpty) return const ParsedPattern(error: 'အပြီးခွေ ဂဏန်း မရပါ');
    return ParsedPattern(numbers: expanded.numbers, grouptype: 30000);
  }
  if (raw == 'SM') {
    if (digits != 2) return const ParsedPattern(error: 'SM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    const fronts = [0, 2, 4, 6, 8];
    const backs = [1, 3, 5, 7, 9];
    final numbers = [for (final f in fronts) for (final b in backs) '$f$b'];
    return ParsedPattern(numbers: numbers, grouptype: 30052);
  }
  if (raw == 'MM') {
    if (digits != 2) return const ParsedPattern(error: 'MM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    const odds = [1, 3, 5, 7, 9];
    final numbers = [for (final f in odds) for (final b in odds) '$f$b'];
    return ParsedPattern(numbers: numbers, grouptype: 30051);
  }
  if (raw == 'MS') {
    if (digits != 2) return const ParsedPattern(error: 'MS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    const fronts = [1, 3, 5, 7, 9];
    const backs = [0, 2, 4, 6, 8];
    final numbers = [for (final f in fronts) for (final b in backs) '$f$b'];
    return ParsedPattern(numbers: numbers, grouptype: 30053);
  }
  if (raw == 'SS') {
    if (digits != 2) return const ParsedPattern(error: 'SS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    const evens = [0, 2, 4, 6, 8];
    final numbers = [for (final f in evens) for (final b in evens) '$f$b'];
    return ParsedPattern(numbers: numbers, grouptype: 30050);
  }
  if (raw == 'SP') {
    if (digits != 2) return const ParsedPattern(error: 'SP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = [0, 2, 4, 6, 8].map((d) => '$d$d').toList();
    return ParsedPattern(numbers: numbers, grouptype: 30061);
  }
  if (raw == 'MP') {
    if (digits != 2) return const ParsedPattern(error: 'MP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = [1, 3, 5, 7, 9].map((d) => '$d$d').toList();
    return ParsedPattern(numbers: numbers, grouptype: 30062);
  }
  if (raw == 'T') {
    if (digits != 3) return const ParsedPattern(error: 'T ပုံစံသည် 3D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = List.generate(10, (d) => '$d$d$d');
    return ParsedPattern(numbers: numbers, grouptype: 31033);
  }
  // <prefix>*, e.g. "12*" (3D) -> 120..129, or "5*" (2D) -> 50..59. * fills the last digit.
  var m = RegExp(r'^(\d+)\*$').firstMatch(raw);
  if (m != null) {
    final prefix = m[1]!;
    if (prefix.length != digits - 1) return ParsedPattern(error: 'ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်');
    final numbers = List.generate(10, (d) => '$prefix$d');
    return ParsedPattern(numbers: numbers, grouptype: 31032);
  }
  // *<suffix>, e.g. "*12" (3D) -> 012..912. * fills the first digit.
  m = RegExp(r'^\*(\d+)$').firstMatch(raw);
  if (m != null) {
    final suffix = m[1]!;
    if (suffix.length != digits - 1) return ParsedPattern(error: 'ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်');
    final numbers = List.generate(10, (d) => '$d$suffix');
    return ParsedPattern(numbers: numbers, grouptype: 31030);
  }
  // <front>*<back>, e.g. "1*2" (3D) -> 102..192. * fills the middle digit.
  m = RegExp(r'^(\d+)\*(\d+)$').firstMatch(raw);
  if (m != null) {
    final front = m[1]!;
    final back = m[2]!;
    if (front.length + back.length != digits - 1) return ParsedPattern(error: 'ဂဏန်း ${digits - 1} လုံး + * ဖြစ်ရမည်');
    final numbers = List.generate(10, (d) => '$front$d$back');
    return ParsedPattern(numbers: numbers, grouptype: 310031);
  }
  m = RegExp(r'^(\d)B$').firstMatch(raw);
  if (m != null) {
    if (digits != 2) return ParsedPattern(error: '$raw ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final k = int.parse(m[1]!);
    final numbers = List.generate(10, (a) => '$a${(10 + k - a) % 10}');
    return ParsedPattern(numbers: numbers, grouptype: 31007);
  }
  if (raw == 'N') {
    if (digits != 2) return const ParsedPattern(error: 'N ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = <String>[];
    for (var b = 0; b <= 9; b++) {
      numbers.add('${(b + 1) % 10}$b');
    }
    for (var f = 0; f <= 9; f++) {
      numbers.add('$f${(f + 1) % 10}');
    }
    return ParsedPattern(numbers: numbers, grouptype: 30009);
  }
  if (raw == 'P') {
    if (digits != 2) return const ParsedPattern(error: 'P ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = List.generate(10, (d) => '$d$d');
    return ParsedPattern(numbers: numbers, grouptype: 30060);
  }
  // <digit>P, e.g. "1P" -> front digit 1 union back digit 1, 19 numbers.
  m = RegExp(r'^(\d)P$').firstMatch(raw);
  if (m != null) {
    if (digits != 2) return const ParsedPattern(error: 'ဂဏန်းP ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final d = m[1]!;
    final numbers = <String>{};
    for (var i = 0; i <= 9; i++) {
      numbers.add('$d$i');
    }
    for (var i = 0; i <= 9; i++) {
      numbers.add('$i$d');
    }
    return ParsedPattern(numbers: numbers.toList(), grouptype: 30004);
  }
  // <digit>S, e.g. "1S" -> digit paired with each even digit, both directions.
  m = RegExp(r'^(\d)S$').firstMatch(raw);
  if (m != null) {
    if (digits != 2) return const ParsedPattern(error: 'ဂဏန်းS ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final d = m[1]!;
    final numbers = <String>[];
    for (final e in [0, 2, 4, 6, 8]) {
      numbers.add('$d$e');
      numbers.add('$e$d');
    }
    return ParsedPattern(numbers: numbers, grouptype: 30083);
  }
  // <digit>M, e.g. "1M" -> digit paired with each odd digit, both directions.
  m = RegExp(r'^(\d)M$').firstMatch(raw);
  if (m != null) {
    if (digits != 2) return const ParsedPattern(error: 'ဂဏန်းM ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final d = m[1]!;
    final numbers = <String>[];
    for (final o in [1, 3, 5, 7, 9]) {
      numbers.add('$d$o');
      numbers.add('$o$d');
    }
    return ParsedPattern(numbers: numbers, grouptype: 30080);
  }
  if (raw == 'W') {
    if (digits != 2) return const ParsedPattern(error: 'W ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    final numbers = <String>[];
    for (var d = 0; d < 5; d++) {
      numbers.add('$d${d + 5}');
      numbers.add('${d + 5}$d');
    }
    return ParsedPattern(numbers: numbers, grouptype: 30070);
  }
  if (raw == 'K') {
    if (digits != 2) return const ParsedPattern(error: 'K ပုံစံသည် 2D အတွက်သာ ဖြစ်ပါသည်');
    const numbers = ['07', '70', '18', '81', '24', '42', '35', '53', '69', '96'];
    return const ParsedPattern(numbers: numbers, grouptype: 30071);
  }
  // RR suffix = same permutations as R, but excludes the entered base number itself.
  m = RegExp(r'^(\d+)RR$').firstMatch(raw);
  if (m != null) {
    final base = m[1]!;
    if (base.length != digits) return ParsedPattern(error: 'ဂဏန်း $digits လုံး ဖြစ်ရမည်');
    if (hasRepeatDigits(base)) return const ParsedPattern(error: 'ထပ်ဂဏန်း ပါလို့ အခွေ ရိုက်မရပါ');
    final numbers = uniquePermutations(base).where((n) => n != base).toList();
    if (numbers.isEmpty) return ParsedPattern(error: '$base ကျန်ဂဏန်း မရှိပါ');
    return ParsedPattern(numbers: numbers, grouptype: 31003);
  }
  // Plain R suffix = every unique permutation INCLUDING the base itself, e.g. "25R" -> 25,52 (2
  // numbers) and "78R" -> 78,87 — per the shop owner's explicit correction: R and RR are NOT the
  // same bet after all (an earlier session change had briefly made R exclude the base too; this
  // reverts just that one regex back to including it, RR is unaffected and still excludes it).
  m = RegExp(r'^(\d+)R$').firstMatch(raw);
  if (m != null) {
    final base = m[1]!;
    if (base.length != digits) return ParsedPattern(error: 'ဂဏန်း $digits လုံး ဖြစ်ရမည်');
    if (hasRepeatDigits(base)) return const ParsedPattern(error: 'ထပ်ဂဏန်း ပါလို့ အခွေ ရိုက်မရပါ');
    final numbers = uniquePermutations(base);
    final grouptype = numbers.length > 1 ? (digits == 3 ? 31001 : 30001) : null;
    return ParsedPattern(numbers: numbers, grouptype: grouptype);
  }
  if (raw.contains('R')) return const ParsedPattern(error: 'R ပုံစံ မှားနေပါတယ် (ဥပမာ - 45R)');
  if (RegExp(r'^\d+$').hasMatch(raw)) {
    if (raw.length != digits) return ParsedPattern(error: 'ဂဏန်း $digits လုံး ဖြစ်ရမည်');
    return ParsedPattern(numbers: [raw]);
  }
  return ParsedPattern(error: '"$raw" ပုံစံ မမှန်ကန်ပါ');
}

/// One bet read from pasted text: the pattern key (e.g. "25", "25R", "3P") and its unit.
typedef PastedBet = ({String key, double unit});

// Myanmar pattern words in pasted messages -> the keypad's own codes. Longest first, so "အပါ"
// is replaced before "ပါ", "စုံပူး" before "စုံ", and so on.
const _pasteWords = <(String, String)>[
  ('စုံပူး', ' SP '), ('မပူး', ' MP '), ('အပူး', ' DOUBLES '), ('ညီကို', ' N '), ('ပါဝါ', ' W '),
  ('နက္ခက်', ' K '), ('ထွိုင်', ' T '), ('စုံစုံ', ' SS '), ('စုံမ', ' SM '), ('မစုံ', ' MS '), ('မမ', ' MM '),
  ('ဘရိတ်', 'B'), ('အပါ', 'P'), ('ပါ', 'P'), ('စုံ', 'S'),
];

/// ကူး (paste): reads bets out of a message copied from Viber / Telegram / SMS.
///
/// Full lines — numbers/patterns, then the unit last:
///   "25 1000", "25-1000", "25R 500", "25r500", "47/74 200", "25,52 1,000", "၂၅ ၁၀၀၀",
///   "အပူး 300" (P), "3အပါ 1500" / "2ပါ 100" (3P / 2P), "1ဘရိတ် 200" (1B),
///   "1/5 အပါ 100" (1P and 5P), and this app's own shared slip lines ("45R - 100").
/// Header lines — the bare numbers on the lines under them take their unit:
///   "R 3100" / "R. 53000" / "R300" / "r200": each number as one R card at that unit
///   (16 -> 16R); a double gets the unit twice (11 -> 11 at 600);
///   "300R100": each number at 300 and its reverse at 100.
/// A header lasts until the next full line or header. Lines that don't fit [digits] (dates,
/// totals, a bare number with no header above it, ...) come back in `skipped`.
({List<PastedBet> bets, List<String> skipped}) parsePastedBets(String text, int digits) {
  const myanmarDigits = '၀၁၂၃၄၅၆၇၈၉';
  final bets = <PastedBet>[];
  final skipped = <String>[];
  final plain = RegExp(r'^\d+$');
  bool isNumber(String t) => t.length == digits && plain.hasMatch(t);

  List<String> tokensOf(String original) {
    var line = original.split('').map((c) {
      final i = myanmarDigits.indexOf(c);
      return i >= 0 ? '$i' : c;
    }).join();
    for (final (word, code) in _pasteWords) {
      line = line.replaceAll(word, code);
    }
    line = line.toUpperCase();
    // "1,000" / "10,000" at the end of a line is one amount, not two numbers.
    line = line.replaceAllMapped(RegExp(r'(\d{1,3}(?:,\d{3})+)\s*(KS|ကျပ်)?\s*$'), (m) => m[1]!.replaceAll(',', ''));
    line = line.replaceAll(RegExp(r'\((\d+)\)'), ' '); // "(20)" counts in shared slips
    final tokens = <String>[];
    for (final t in line.split(RegExp(r'[^0-9A-Z*]+')).where((t) => t.isNotEmpty)) {
      final glued = RegExp(r'^(\d{' '$digits' r'}R{1,2})(\d+)$').firstMatch(t);
      if (glued != null && !RegExp(r'^\d+R\d+$').hasMatch(t)) {
        tokens..add(glued[1]!)..add(glued[2]!); // "25RR500" -> "25RR", "500"
      } else if ((t == 'R' || t == 'RR') && tokens.isNotEmpty && plain.hasMatch(tokens.last)) {
        tokens.last = '${tokens.last}$t'; // "25 R 500"
      } else if (const {'P', 'B', 'S', 'M'}.contains(t) && tokens.isNotEmpty && RegExp(r'^\d$').hasMatch(tokens.last)) {
        // "1/5 P 100" -> 1P, 5P: the suffix goes on every single digit just before it.
        for (var i = tokens.length - 1; i >= 0 && RegExp(r'^\d$').hasMatch(tokens[i]); i--) {
          tokens[i] = '${tokens[i]}$t';
        }
      } else {
        tokens.add(t == 'DOUBLES' ? 'P' : t);
      }
    }
    return tokens;
  }

  final lines = text.split(RegExp(r'[\r\n]+')).map((l) => l.trim()).where((l) => l.isNotEmpty).toList();
  final tokenLines = [for (final l in lines) tokensOf(l)];
  bool nextIsBareNumber(int i) => i + 1 < tokenLines.length && tokenLines[i + 1].length == 1 && isNumber(tokenLines[i + 1].first);

  double? straight; // current header: unit for the number itself
  double? reverse; //  ... and for its reverse
  for (var i = 0; i < lines.length; i++) {
    final original = lines[i];
    var tokens = tokenLines[i];

    // Headers: "R 3100" / "R. 53000" / "R300" / "r200", or "300R100" (in 3D only when bare
    // numbers follow, since "125R100" is also a full 3D line).
    final rx = tokens.length == 1 ? RegExp(r'^(\d+)R(\d+)$').firstMatch(tokens.first) : null;
    final rOnly = tokens.length == 1 ? RegExp(r'^R(\d+)$').firstMatch(tokens.first) : null;
    if (tokens.length == 2 && tokens.first == 'R' && plain.hasMatch(tokens.last)) {
      straight = reverse = double.parse(tokens.last);
      continue;
    }
    if (rOnly != null) {
      straight = reverse = double.parse(rOnly[1]!);
      continue;
    }
    if (rx != null && (rx[1]!.length != digits || nextIsBareNumber(i))) {
      straight = double.parse(rx[1]!);
      reverse = double.parse(rx[2]!);
      continue;
    }
    if (rx != null) tokens = ['${rx[1]}R', rx[2]!]; // not a header: "25R500" = 25R at 500
    // A bare number under a header. A double like 11 has no other ordering, so it takes both
    // units (R300: 11 at 600). Same unit both ways (R300): one R card, 16 -> 16R at 300.
    // Different units (300R100): the number at 300, each reverse as its own card at 100.
    if (tokens.length == 1 && isNumber(tokens.first) && straight != null) {
      final n = tokens.first;
      final others = uniquePermutations(n).where((p) => p != n).toList()..sort();
      if (others.isEmpty) {
        if (straight + reverse! > 0) bets.add((key: n, unit: straight + reverse));
      } else if (straight == reverse) {
        if (straight > 0) bets.add((key: '${n}R', unit: straight));
      } else {
        if (straight > 0) bets.add((key: n, unit: straight));
        for (final p in others) {
          if (reverse! > 0) bets.add((key: p, unit: reverse));
        }
      }
      continue;
    }
    // A full line ends the header block.
    if (tokens.length < 2 || !plain.hasMatch(tokens.last)) {
      if (RegExp(r'\d').hasMatch(original)) skipped.add(original);
      continue;
    }
    final unit = double.parse(tokens.last);
    final keys = tokens.sublist(0, tokens.length - 1);
    if (unit <= 0 || keys.any((k) => !parseEntry(k, digits).ok)) {
      skipped.add(original);
      continue;
    }
    straight = reverse = null;
    for (final k in keys) {
      bets.add((key: k, unit: unit));
    }
  }
  return (bets: bets, skipped: skipped);
}
