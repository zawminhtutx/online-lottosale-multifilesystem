import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, FilteringTextInputFormatter;

import '../models/pattern_entry.dart';
import '../services/gemini_service.dart';
import '../services/pattern_parser.dart';
import '../services/responsive.dart';
import '../services/sound_service.dart';
import '../widgets/big_key.dart';
import '../widgets/display_text.dart';
import '../widgets/small_key.dart';

const _numberColor = Color(0xFF4F46E5);

// Keypad palette (the dashboard's indigo look): pattern keys indigo, digits navy on white,
// ENTER / hide in dark navy.
const _kIndigo = Color(0xFF4F46E5);
const _kViolet = Color(0xFF7C3AED);
const _kInk = Color(0xFF1E1B4B);
const _kLavender = Color(0xFFE4E4FB);
const _kTeal = Color(0xFF0D9488);

// The FAB drawer — one shared keypad; tapping the ဂဏန်း or ယူနစ် display box picks which
// field digits go into. ခွေ appends R (reverse/permutation), the စီးရီး key appends *
// (wildcard) — same math as the desktop's parseEntry either way.
//
// Three keys have no equivalent anywhere else in this codebase to copy exact behavior from
// (this design is new), so they use a documented best-guess rather than blocking on it:
//  - "အမြန်" (quick) opens a picker for the desktop's letter-coded patterns (SM/MM/W/K/T/...)
//    since this numeric-only keypad has no way to type a letter otherwise.
//  - "ကူး" (paste) reads bets copied from Viber / Telegram / SMS (see _pasteBets); it is the
//    first item of the အမြန် list in both 2D and 3D, and 3D also has it as a key.
//  - "/" separates multiple patterns typed in one go, e.g. "12/34" adds both 12 and 34.
// Flag any of these to change if they're not what was intended.
class PatternKeypadSheet extends StatefulWidget {
  final int digits;
  final List<PatternEntry> cart;
  final VoidCallback onChanged;
  // Whether this instance is showing as BetScreen's persistent Scaffold.bottomSheet (stays open
  // across multiple entries, doesn't dim/block the sale table behind it) rather than a one-shot
  // showModalBottomSheet — purely cosmetic here (hides the drag handle, which nothing reacts to
  // once docked) except for which icon the dock toggle shows.
  final bool docked;
  // Flips docked on/off — BetScreen owns the actual state and swaps which of
  // showModalBottomSheet/Scaffold.bottomSheet is presenting this widget.
  final VoidCallback onToggleDock;
  // BetScreen's own submit() — actually saves the cart as a sale (DB write + slip dialog), unlike
  // this sheet's own ပြည့်ဂဏန်း/အခွေ/ENTER keys which only add one entry to the cart. Wired to a
  // 3-second long-press on ပြည့်ဂဏန်း (see _addThenSubmit) as a shortcut so the operator doesn't
  // have to close the drawer and reach for BetScreen's own ထိုးမည် button separately.
  final VoidCallback onSubmitSale;
  // BetScreen's own break-limit check (the live savedUnitsByNumber/numberLimitOverrides ledger
  // lives there, not here) — called with the numbers a pattern is about to commit and its unit
  // right before it's actually added, so an over-limit number blocks with a confirmation dialog
  // showing ကျွံ/ကျံ per number (ungrouped, even for a pattern like "78R") instead of only being
  // caught later at Save time. Returns whether to proceed; false leaves the typed entry untouched
  // so the operator can adjust it. Extra Save on always resolves true without asking.
  final Future<bool> Function(List<String> numbers, double unit) checkBreakLimit;
  // BetScreen's own ledger again — pops a dialog listing every number already at/over its break
  // limit, ascending order. See _addAsPlain's own comment for when this fires.
  final VoidCallback onShowFullNumbers;
  const PatternKeypadSheet({
    super.key,
    required this.digits,
    required this.cart,
    required this.onChanged,
    required this.docked,
    required this.onToggleDock,
    required this.onSubmitSale,
    required this.checkBreakLimit,
    required this.onShowFullNumbers,
  });

  @override
  State<PatternKeypadSheet> createState() => _PatternKeypadSheetState();
}

class _PatternKeypadSheetState extends State<PatternKeypadSheet> {
  String field = 'number';
  String number = '';
  String unit = '1';
  String? error;

  // L/R/U — 2D-only quick-entry modes above the ယူနစ် box, ported from the same-named toggles on
  // the desktop's own Sale page (client/src/pages/SalePage.jsx) so staff who already know that
  // workflow get it here too.
  //  - L (sequential sweep): Number auto-advances 00, 01, 02, ... after every commit, focus stays
  //    on Unit — lets staff sweep every number in order without retyping Number. An empty Unit on
  //    commit just skips to the next number silently. Mutually exclusive with R and U.
  //  - R (R-mode): whatever plain digits are typed in Number always commits as that digit
  //    string's R (all-permutations) pattern — same effect as manually appending the ခွေ/R key —
  //    without having to tap it every time. Combines freely with U; exclusive with L.
  //  - U (fixed-unit): Unit is locked at whatever value it holds when U turns on; completing
  //    Number commits immediately with that value (Unit is never focused/cleared) and focus stays
  //    on Number for the next entry. Combines freely with R; exclusive with L.
  bool sequentialEntry = false;
  bool rMode = false;
  bool unitLocked = false;

  // R on its own (Number empty) = "the reverse of the last plain number": 25 -> unit -> ENTER, then
  // R -> unit -> ENTER adds 52; in 3D 125 then R adds 152, 215, 251, 512, 521. Each reverse number
  // goes in as its own plain card (the base itself is not added again).
  String? lastPlain;

  void _rememberPlain(String key) {
    if (key.length == widget.digits && RegExp(r'^\d+$').hasMatch(key)) lastPlain = key;
  }

  List<String> _reversesOfLast() {
    final base = lastPlain;
    if (base == null) return const [];
    return uniquePermutations(base).where((n) => n != base).toList()..sort();
  }

  bool get is3d => widget.digits == 3;

  int get _maxNumberValue {
    var v = 1;
    for (var i = 0; i < widget.digits; i++) {
      v *= 10;
    }
    return v;
  }

  // L (sequential sweep), R mode and U (fixed unit) toggles.
  Future<void> _toggleSequentialEntry() async {
    if (!mounted) return;
    SoundService.instance.keyPress();
    setState(() {
      sequentialEntry = !sequentialEntry;
      if (sequentialEntry) {
        rMode = false;
        unitLocked = false;
        number = ''.padLeft(widget.digits, '0');
        unit = '';
        field = 'unit';
      }
      error = null;
    });
  }

  Future<void> _toggleRMode() async {
    if (!mounted) return;
    SoundService.instance.keyPress();
    setState(() {
      rMode = !rMode;
      if (rMode) {
        sequentialEntry = false;
        field = 'number';
      }
      error = null;
    });
  }

  Future<void> _toggleUnitLock() async {
    if (!mounted) return;
    SoundService.instance.keyPress();
    setState(() {
      unitLocked = !unitLocked;
      if (unitLocked) {
        sequentialEntry = false;
        field = 'number';
      }
      error = null;
    });
  }

  // R-mode's actual effect on commit — a pure digit string always commits as its own R
  // (all-permutations) pattern, same as manually typing e.g. "45R" — never as a plain single
  // number, since that's exactly the shortcut R-mode exists to save. Never mutates what's shown
  // in the Number box itself, only what actually gets parsed/committed — same as the desktop.
  String _applyRMode(String raw) => (rMode && RegExp(r'^\d+$').hasMatch(raw)) ? '${raw}R' : raw;

  // L-mode sweep — wraps back to '0'.repeat(digits) after the highest number and clears Unit, so
  // staff never has to touch Number or re-tap it. A pure state mutator (no setState of its own)
  // since every call site already has one open — see _add() and the empty-Unit skip case.
  void _advanceSequentialNumberState() {
    final next = ((int.tryParse(number) ?? 0) + 1) % _maxNumberValue;
    number = next.toString().padLeft(widget.digits, '0');
    unit = '';
    field = 'unit';
  }

  // Shared by every place Number can become a complete entry (typing a digit, appending R/P/B/
  // S/M, or picking a standalone pattern like T/W/K) — normally just jumps to Unit like before,
  // but when "U" fixed-unit mode is on, commits straight away with whatever Unit already holds
  // and keeps focus on Number instead, for rapid repeat entry. The commit itself is fire-and-
  // forget (see _commit — it may need to await a break-limit confirmation dialog first, which
  // can't happen inside this function's own synchronous setState call), so Number/Unit only
  // reset and widget.onChanged() only fires once _commit's own Future actually resolves true;
  // cancelling that confirmation leaves everything exactly as typed, untouched, for the operator
  // to adjust instead of silently discarding it.
  void _onNumberCompleted({required bool wasNumberField}) {
    if (unitLocked) {
      final u = double.tryParse(unit) ?? 0;
      if (u > 0) {
        final key = _applyRMode(number);
        _commit(key, u).then((committed) {
          if (!committed || !mounted) return;
          _rememberPlain(key);
          setState(() {
            number = '';
            field = 'number';
          });
          widget.onChanged();
        });
        return;
      }
    }
    field = 'unit';
    if (wasNumberField) unit = '';
  }

  // Auto-jumps to Unit the moment Number holds a complete entry — a plain number at full
  // length, or a finished pattern (R, N, K, W, SS, MM, MS, SM, P, 1S, 2P, 12*, ...) — instead of
  // waiting for a separate action to switch fields. Reuses parseEntry itself so every pattern
  // this keypad recognizes gets the shortcut for free, with no separate "is this complete" list
  // to maintain (same approach as the desktop client's own Auto mode — see tryAutoFocusUnit in
  // client/src/pages/SalePage.jsx). Unit starts blank on the jump so the next digit tapped is
  // the start of a fresh value, not appended after whatever Unit held from the previous entry.
  void _typeInField(String Function(String cur) transform) {
    setState(() {
      if (field == 'number') {
        number = transform(number);
        if (parseEntry(number, widget.digits).ok) {
          _onNumberCompleted(wasNumberField: true);
        }
      } else {
        unit = transform(unit);
      }
      error = null;
    });
  }

  void _tapDigit(String d) {
    SoundService.instance.keyPress();
    _typeInField((cur) => cur + d);
  }
  // Unlike every other key, R is a modifier on the Number pattern (reverse/permutation) even
  // once Unit already has focus — same rule as the desktop client's Sale/Buy pages: pressing R
  // while typing Unit converts Number into its R pattern instead of literally typing the letter
  // "R" into Unit, which isn't a valid unit value. Only clears Unit on the jump if Number wasn't
  // already complete (i.e. this is what completes it) — if Unit already had digits typed before R
  // was pressed, those stay untouched.
  void _appendR() {
    SoundService.instance.keyPress();
    // Lone R: the reverse of the last plain number (see lastPlain) — jump to Unit for its amount.
    final digitsOnly = number.replaceAll(RegExp(r'\D'), '');
    if (digitsOnly.isNotEmpty && hasRepeatDigits(digitsOnly)) {
      setState(() => error = 'ထပ်ဂဏန်း ပါလို့ အခွေ ရိုက်မရပါ');
      return;
    }
    if (number.isEmpty) {
      final reverses = _reversesOfLast();
      setState(() {
        if (lastPlain == null) {
          error = 'ဂဏန်း အရင်ရိုက်ပြီးမှ R နှိပ်ပါ (ဥပမာ - 25 ပြီးမှ R)';
        } else if (reverses.isEmpty) {
          error = '$lastPlain ၏ အပြန်ဂဏန်း မရှိပါ';
        } else {
          number = 'R';
          error = null;
          if (unitLocked && (double.tryParse(unit) ?? 0) > 0) {
            Future.microtask(_add);
          } else {
            field = 'unit';
            unit = '';
          }
        }
      });
      return;
    }
    setState(() {
      final wasNumberField = field == 'number';
      number = '${number}R';
      if (parseEntry(number, widget.digits).ok) {
        _onNumberCompleted(wasNumberField: wasNumberField);
      }
      error = null;
    });
  }

  // ဘရိတ် (2D): <digit>B, e.g. 5B = every number whose digits add up to 5 (see pattern_parser.dart).
  void _appendB() {
    SoundService.instance.keyPress();
    _typeInField((cur) => '${cur}B');
  }

  void _appendMinus() {
    SoundService.instance.keyPress();
    if (widget.digits != 2) return;
    if (!RegExp(r'^\d{3,}$').hasMatch(number)) {
      setState(() => error = 'ဂဏန်း သုံးလုံး အရင်ရိုက်ပါ (ဥပမာ - 145 ပြီးမှ -)');
      return;
    }
    setState(() {
      number = '$number-';
      error = null;
      if (parseEntry(number, widget.digits).ok) {
        _onNumberCompleted(wasNumberField: field == 'number');
      }
    });
  }

  void _appendStar() {
    SoundService.instance.keyPress();
    _typeInField((cur) => '$cur*');
  }

  void _clearField() {
    SoundService.instance.delete();
    _typeInField((_) => '');
  }

  // A standalone letter pattern (T/W/K/...) is a complete entry on its own, not a suffix
  // appended to typed digits — picked from the အမြန် quick-pattern list.
  void _selectPattern(String code) {
    SoundService.instance.keyPress();
    setState(() {
      number = code;
      _onNumberCompleted(wasNumberField: true);
      error = null;
    });
  }

  // အပါ (P): a suffix on a single digit (3P = 3အပါ), not the standalone P doubles pattern
  // (အပူး) further down the same အမြန် list. Same as tapping ဘရိတ် after a digit.
  void _appendP() {
    SoundService.instance.keyPress();
    if (!RegExp(r'^\d$').hasMatch(number)) {
      setState(() => error = 'ဂဏန်း တစ်လုံး အရင်ရိုက်ပါ (ဥပမာ - 3 ပြီးမှ အပါ)');
      return;
    }
    _typeInField((cur) => '${cur}P');
  }

  void _openQuickPatterns() {
    SoundService.instance.keyPress();
    // APA sits above SM so 2D staff can pick အပါ(P) without scrolling; it appends P rather
    // than selecting a complete code (see _appendP). P later in this list is still အပူး.
    final all2d = ['APA', 'SM', 'MM', 'MS', 'SS', 'SP', 'MP', 'P', 'N', 'W', 'K'];
    final all3d = ['T'];
    final codes = is3d ? all3d : all2d;
    // ကူး (paste bets copied from Viber / Telegram / SMS) is the first item in both 2D and 3D:
    // 2D has no ကူး key any more (that slot is ဘရိတ်), and 3D keeps its key as well as this.
    const copyCode = 'PASTE';
    codes.insert(0, copyCode);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        // A plain (non-scrolling) Wrap here used to just clip on a shorter real-device screen
        // instead of shrinking — the sheet took its intrinsic height and anything past the
        // visible edge (the LAST few codes, e.g. N/W/K in 2D) was silently unreachable rather
        // than scrollable. Capping the height and scrolling fixes that on every screen size.
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
          child: SingleChildScrollView(
            child: Wrap(
              children: codes
                  .map((c) => ListTile(
                        title: Text(
                            c == copyCode
                                ? 'ကူး (Viber / Telegram မှ Copy ကူးထားတာ ထည့်ရန်)'
                                : c == 'APA'
                                    ? 'အပါ (P)'
                                    : '${patternLabel(c)} ($c)',
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        onTap: () {
                          Navigator.pop(ctx);
                          if (c == copyCode) {
                            _pasteBets();
                            return;
                          }
                          if (c == 'APA') {
                            _appendP();
                            return;
                          }
                          // Every quick-pattern code is already a complete entry by definition, so
                          // this jumps straight to Unit too, same as finishing one by hand would.
                          _selectPattern(c);
                        },
                      ))
                  .toList(),
            ),
          ),
        ),
      ),
    );
  }

  // One of the L/R/U mode buttons above the ယူနစ် box — a small filled pill when active, an
  // outlined one when not, same visual language as the rest of this keypad's own key styling.
  Widget _modeToggle(String label, bool active, VoidCallback onTap, String tooltip) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: active ? _numberColor : Colors.white,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            height: 26,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: active ? _numberColor : Colors.grey.shade300)),
            alignment: Alignment.center,
            child: Text(label, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: active ? Colors.white : _numberColor)),
          ),
        ),
      ),
    );
  }

  // DisplayText itself has no tap/active concept (see widgets/display_text.dart) — wrapping it
  // here is what lets tapping either box pick which field the keypad types into.
  Widget _fieldBox(String value, bool active, VoidCallback onTap, TextAlign textAlign) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: active ? BoxDecoration(borderRadius: BorderRadius.circular(10), color: _kIndigo.withValues(alpha: .08)) : null,
        child: DisplayText(text: value.isEmpty ? '-' : value, textAlign: textAlign),
      ),
    );
  }

  // Async because an over-break number needs to await widget.checkBreakLimit's confirmation
  // dialog before it's actually added — every caller treats this as fire-and-forget (or, in
  // _add's case, waits on all of them together) rather than wrapping it in their own setState,
  // since a dialog can't be awaited from inside a synchronous setState callback. Returns whether
  // it actually committed, so callers know whether to reset Number/Unit and fire onChanged.
  Future<bool> _commit(String key, double u) async {
    return _commitParsed(key, parseEntry(key, widget.digits), u);
  }

  Future<bool> _commitParsed(String key, ParsedPattern parsed, double u) async {
    if (!parsed.ok) {
      if (mounted) setState(() => error = parsed.error);
      return false;
    }
    final proceed = await widget.checkBreakLimit(parsed.numbers, u);
    if (!proceed || !mounted) return false;
    setState(() {
      final existing = widget.cart.where((e) => e.key == key).toList();
      if (existing.isNotEmpty) {
        existing.first.unit += u;
      } else {
        widget.cart.add(PatternEntry(
          key: key,
          numbers: List<String>.from(parsed.numbers),
          grouptype: parsed.grouptype,
          unit: u,
        ));
      }
    });
    return true;
  }

  // Returns whether the line is now fully handled — either something committed, or there was
  // genuinely nothing left to do (the L-mode empty-Unit skip) — false on a validation error OR
  // when every part's break-limit confirmation was declined, so _addThenSubmit below can tell
  // "still needs the operator's attention" apart from "go ahead and submit".
  Future<bool> _add() async {
    // L-mode: an empty Unit means "no bet on this number" — skip straight to the next number
    // instead of the usual "ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ" error, same as the desktop's own sweep.
    if (sequentialEntry && unit.trim().isEmpty) {
      setState(_advanceSequentialNumberState);
      return true;
    }
    final u = double.tryParse(unit) ?? 0;
    if (number.isEmpty || u <= 0) {
      setState(() => error = 'ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ');
      return false;
    }
    // R-mode applies before parsing/committing, never to what's shown in the Number box — see
    // _applyRMode.
    final parts = number
        .split('/')
        .where((s) => s.trim().isNotEmpty)
        .expand((s) => s.trim() == 'R' ? _reversesOfLast() : [_applyRMode(s.trim())])
        .toList();
    if (parts.isEmpty) {
      setState(() => error = 'ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ');
      return false;
    }
    final jobs = <({String key, ParsedPattern parsed})>[];
    for (final p in parts) {
      if (widget.digits == 2 && !rMode && RegExp(r'^\d{3,}-?$').hasMatch(p)) {
        final digitsOnly = p.replaceAll('-', '');
        final withDoubles = !p.endsWith('-');
        if (hasRepeatDigits(digitsOnly)) {
          setState(() => error = 'ထပ်ဂဏန်း ပါလို့ အပြီးခွေ ရိုက်မရပါ');
          return false;
        }
        final preview = expandApayePauk(digitsOnly, withDoubles: withDoubles);
        if (preview.numbers.isEmpty) {
          setState(() => error = 'အပြီးခွေ ဂဏန်း မရပါ');
          return false;
        }
        if (withDoubles) {
          final ok = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('အပြီးခွေ'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$digitsOnly ကို အပြီးခွေ ရိုက်မှာလား?'),
                  const SizedBox(height: 8),
                  Text(preview.codes.join(', '), style: const TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text('${preview.numbers.length} ကွက်', style: const TextStyle(color: Colors.grey)),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
                FilledButton(autofocus: true, onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes')),
              ],
            ),
          );
          if (!mounted || ok != true) return false;
        }
        jobs.add((
          key: withDoubles ? digitsOnly : p,
          parsed: ParsedPattern(numbers: preview.numbers, grouptype: 30000),
        ));
      } else {
        final parsed = parseEntry(p, widget.digits);
        if (!parsed.ok) {
          setState(() => error = parsed.error);
          return false;
        }
        jobs.add((key: p, parsed: parsed));
      }
    }
    // Each part awaits its own break-limit confirmation independently (a cancelled one just
    // doesn't get added — the rest of the line still can), then Number/Unit only reset once
    // every part has been decided one way or the other.
    final results = await Future.wait([for (final j in jobs) _commitParsed(j.key, j.parsed, u)]);
    if (!mounted) return false;
    if (!results.contains(true)) return false;
    // A lone R reuses the same base again, so only typed numbers become the new base.
    if (!number.split('/').any((s) => s.trim() == 'R')) {
      for (var i = 0; i < jobs.length; i++) {
        if (results[i]) _rememberPlain(jobs[i].key);
      }
    }
    setState(() {
      if (sequentialEntry) {
        _advanceSequentialNumberState();
      } else {
        number = '';
        field = 'number';
      }
      error = null;
    });
    widget.onChanged();
    return true;
  }

  // အခွေ opens a bulk "wheel number" dialog instead of committing Number directly — type several
  // digits (e.g. "123" for 2D, or however many for 3D) plus its own ငွေ/ယူနစ် amount (pre-filled
  // from the keypad's own Unit box as a convenience default, but editable independently of it —
  // this dialog never reads widget's outer `unit` state at commit time) and it expands to every
  // <digits>-long combination of them as an R pattern, plus (if အပူး is checked) each individual
  // digit's own double/repdigit, all at that amount:
  //  - "123" (2D) + အပူး ON  -> 11,22,33 (doubles) + 12R,13R,23R (every 2-digit combo, in the
  //    order the digits were typed, not sorted).
  //  - "1875" (2D) + အပူး OFF -> 18R,17R,15R,87R,85R,75R (combos only, no doubles).
  // Added straight into the cart on OK with NO break-limit confirmation per number — generating
  // up to several entries at once, a confirmation dialog for each would defeat the point of a
  // bulk tool; the shop owner's own explicit ask was "add directly". submit()'s own save-time
  // check still catches anything over break, same as always.
  Future<void> _openWheelDialog() async {
    final seed = number.replaceAll(RegExp(r'\D'), '');
    if (seed.isNotEmpty && hasRepeatDigits(seed)) {
      setState(() => error = 'ထပ်ဂဏန်း ပါလို့ အခွေ ရိုက်မရပါ');
      return;
    }
    final numberCtrl = TextEditingController(text: seed);
    final unitCtrl = TextEditingController(text: unit);
    var withDoubles = true;
    String? dialogError;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('အခွေ'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
              controller: numberCtrl,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'ဂဏန်းများ', border: OutlineInputBorder(), hintText: 'ဥပမာ - 123'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: unitCtrl,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'ငွေ (ယူနစ်)', border: OutlineInputBorder()),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: withDoubles,
              title: Text(withDoubles ? 'အပူး' : 'အပူးမပါ'),
              onChanged: (v) => setDialogState(() => withDoubles = v ?? true),
            ),
            if (dialogError != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(dialogError!, style: const TextStyle(color: Colors.red, fontSize: 12.5)),
              ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                if ((double.tryParse(unitCtrl.text) ?? 0) <= 0) {
                  setDialogState(() => dialogError = 'ငွေ ထည့်ပါ');
                  return;
                }
                final typed = numberCtrl.text.trim();
                if (typed.length < widget.digits) {
                  setDialogState(() => dialogError = 'ဂဏန်း ${widget.digits} လုံး အနည်းဆုံး ရိုက်ပါ');
                  return;
                }
                if (hasRepeatDigits(typed)) {
                  setDialogState(() => dialogError = 'ထပ်ဂဏန်း ပါလို့ အခွေ ရိုက်မရပါ');
                  return;
                }
                Navigator.pop(ctx, true);
              },
              child: const Text('OK'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final u = double.tryParse(unitCtrl.text) ?? 0;
    final typed = numberCtrl.text.trim();
    final chars = typed.split('');
    final n = widget.digits;
    if (chars.length < n || u <= 0) return;
    if (chars.toSet().length != chars.length) return;
    if (n == 2) {
      final expanded = expandApayePauk(typed, withDoubles: withDoubles);
      if (expanded.numbers.isEmpty) return;
      SoundService.instance.enter();
      await _commitParsed(
        withDoubles ? typed : '$typed-',
        ParsedPattern(numbers: expanded.numbers, grouptype: 30000),
        u,
      );
      if (mounted) widget.onChanged();
      return;
    }
    final codes = <String>[];
    if (withDoubles) {
      final seen = <String>{};
      for (final c in chars) {
        if (seen.add(c)) codes.add(c * n);
      }
    }
    void combine(int start, List<int> chosen) {
      if (chosen.length == n) {
        codes.add('${chosen.map((i) => chars[i]).join()}R');
        return;
      }
      for (var i = start; i < chars.length; i++) {
        combine(i + 1, [...chosen, i]);
      }
    }
    combine(0, []);
    if (codes.isEmpty) return;
    // Same "into the cart" sound as ENTER on a plain number.
    SoundService.instance.enter();
    setState(() {
      for (final code in codes) {
        final parsed = parseEntry(code, widget.digits);
        if (!parsed.ok) continue;
        final existing = widget.cart.where((e) => e.key == code).toList();
        if (existing.isNotEmpty) {
          existing.first.unit += u;
        } else {
          widget.cart.add(PatternEntry(key: code, numbers: parsed.numbers, grouptype: parsed.grouptype, unit: u));
        }
      }
    });
    widget.onChanged();
  }

  // ပြည့်ဂဏန်း — one-tap alternative to hitting ENTER, so the operator doesn't have to move focus
  // to commit Number as the plain number exactly as typed. Reuses _add()'s own full
  // validation/commit/break-limit path unchanged, same as typing it out and pressing ENTER would.
  // With NOTHING typed in Number, though, there's nothing to commit — this doubles instead as a
  // quick reference: show every ledger number already at/over its own break limit (BetScreen owns
  // that ledger, not this sheet — see widget.onShowFullNumbers), in ascending order, so the
  // operator can check what's already full before typing anything.
  void _addAsPlain() {
    if (number.trim().isEmpty) {
      widget.onShowFullNumbers();
      return;
    }
    SoundService.instance.enter();
    _add();
  }

  // 3-second hold on ပြည့်ဂဏန်း (see build()'s BigKey.onLongPress, and big_key.dart's own
  // RawGestureDetector) — commits whatever's currently typed first (same as a normal tap would),
  // same error handling as _add() above, then hands off to BetScreen's own submit() instead of
  // just adding to the cart. Skips straight to onSubmitSale when Number is already empty, so
  // holding it down still works to save a cart that was filled in entirely by earlier taps. Plays
  // its own submit sound rather than sharing _add()'s caller-side sound since this path never goes
  // through _addAsPlain's own onTap.
  Future<void> _addThenSubmit() async {
    SoundService.instance.submit();
    if (number.isNotEmpty) {
      // Properly awaits _add()'s own break-limit confirmation (if any) before ever reaching
      // onSubmitSale below — this 3-second hold shortcut must never submit while a just-typed
      // over-limit number is still waiting on the operator's answer, or skip it silently.
      final ok = await _add();
      if (!mounted || !ok) return;
    }
    if (widget.cart.isEmpty) {
      setState(() => error = 'ဂဏန်းနှင့် ယူနစ် ဖြည့်ပါ');
      return;
    }
    widget.onSubmitSale();
  }

  // Save: same as the sale screen's ထိုးမည် (BetScreen.submit); the keypad is not closed.
  void _save() {
    if (widget.cart.isEmpty) {
      SoundService.instance.keyPress();
      setState(() => error = 'ဂဏန်းနှင့် ယူနစ် ဖြည့်ပြီး ENTER နှိပ်ပါ');
      return;
    }
    setState(() => error = null);
    widget.onSubmitSale();
  }

  // ကူး — many bets at once from Viber / Telegram / SMS (see parsePastedBets for the line
  // formats). A text box (filled from the clipboard) -> စစ်ဆေးမည် opens a separate result table
  // -> ထည့်မည် there adds everything to the cart with the ENTER sound, like အခွေ does (no
  // per-number break confirmation; Save still checks on the server). With wrong lines the table
  // lists them in red and ပြင်မည် goes back to the text box to fix them.
  // "AI စစ်ဆေး" sends the pasted text to Gemini first to normalise mixed/translated formats.
  Future<void> _pasteBets() async {
    SoundService.instance.keyPress();
    final clip = (await Clipboard.getData(Clipboard.kTextPlain))?.text ?? '';
    if (!mounted) return;
    final ctrl = TextEditingController(text: clip.trim());
    bool aiLoading = false;
    var aiError = '';
    final added = await showDialog<List<PastedBet>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('ကူး'),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (aiError.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(aiError, style: const TextStyle(color: Colors.red, fontSize: 13)),
                  ),
                TextField(
                  controller: ctrl,
                  minLines: 8,
                  maxLines: 14,
                  keyboardType: TextInputType.multiline,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  decoration: InputDecoration(
                    border: const OutlineInputBorder(),
                    hintText: is3d ? '125 1000 / 125R 500 ...' : '25 1000 / R 3100 / 3အပါ 1500 ...',
                  ),
                ),
                Row(children: [
                  TextButton.icon(
                    icon: const Icon(Icons.content_paste, size: 18),
                    label: const Text('Paste'),
                    onPressed: () async {
                      final t = (await Clipboard.getData(Clipboard.kTextPlain))?.text ?? '';
                      setDialogState(() => ctrl.text = t.trim());
                    },
                  ),
                  TextButton.icon(
                    icon: const Icon(Icons.clear, size: 18),
                    label: const Text('ဖျက်'),
                    onPressed: () => setDialogState(ctrl.clear),
                  ),
                  TextButton.icon(
                    icon: aiLoading
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.translate, size: 18),
                    label: const Text('AI စစ်ဆေး'),
                    onPressed: aiLoading
                        ? null
                        : () async {
                            final text = ctrl.text.trim();
                            if (text.isEmpty) return;
                            setDialogState(() => aiLoading = true);
                            try {
                              final result = await GeminiService.translateBets(text);
                              setDialogState(() {
                                ctrl.text = result;
                                aiLoading = false;
                              });
                            } catch (e) {
                              setDialogState(() { aiLoading = false; aiError = '$e'; });
                            }
                          },
                  ),
                ]),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                final r = parsePastedBets(ctrl.text, widget.digits);
                final ok = await _showPasteCheck(ctx, r);
                if (ok == true && ctx.mounted) Navigator.pop(ctx, r.bets);
              },
              child: const Text('စစ်ဆေးမည်'),
            ),
          ],
        ),
      ),
    );
    ctrl.dispose();
    if (added == null || !mounted) return;
    // Same "into the cart" sound as ENTER.
    SoundService.instance.enter();
    setState(() {
      for (final b in added) {
        final parsed = parseEntry(b.key, widget.digits);
        final existing = widget.cart.where((e) => e.key == b.key).toList();
        if (existing.isNotEmpty) {
          existing.first.unit += b.unit;
        } else {
          widget.cart.add(PatternEntry(key: b.key, numbers: parsed.numbers, grouptype: parsed.grouptype, unit: b.unit));
        }
        _rememberPlain(b.key);
      }
      error = null;
    });
    widget.onChanged();
  }

  // စစ်ဆေးမည်'s result: a table of every bet read (ဂဏန်း / ယူနစ်) and the wrong lines in red.
  // true = ထည့်မည် (only offered when nothing is wrong); null = ပြင်မည် (back to the text box).
  Future<bool?> _showPasteCheck(BuildContext ctx, ({List<PastedBet> bets, List<String> skipped}) r) {
    final allGood = r.bets.isNotEmpty && r.skipped.isEmpty;
    const head = TextStyle(fontWeight: FontWeight.w800, color: Colors.white);
    Widget cell(String text, {TextAlign align = TextAlign.left, TextStyle? style}) =>
        Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6), child: Text(text, textAlign: align, style: style));
    return showDialog<bool>(
      context: ctx,
      barrierDismissible: false,
      builder: (dctx) => AlertDialog(
        title: Text(allGood ? '✓ စစ်ပြီး — ${r.bets.length} ကွက်' : 'စစ်ဆေးချက်',
            style: TextStyle(color: allGood ? const Color(0xFF059669) : Colors.red, fontWeight: FontWeight.w900)),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (r.bets.isEmpty && r.skipped.isEmpty)
                const Text('ဂဏန်း မရှိပါ', style: TextStyle(color: Colors.red, fontWeight: FontWeight.w700)),
              if (r.skipped.isNotEmpty) ...[
                Text('မှားနေသော စာကြောင်း ${r.skipped.length} ကြောင်း — ပြင်ပြီး ပြန်စစ်ပါ',
                    style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w800)),
                for (final l in r.skipped) Text('✗ $l', style: const TextStyle(color: Colors.red, fontSize: 14)),
                const SizedBox(height: 10),
              ],
              if (r.bets.isNotEmpty)
                Table(
                  border: TableBorder.all(color: const Color(0xFFDCDAF7)),
                  columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth(), 2: IntrinsicColumnWidth()},
                  children: [
                    TableRow(
                      decoration: const BoxDecoration(color: _kIndigo),
                      children: [cell('စဥ်', style: head), cell('ဂဏန်း', style: head), cell('ယူနစ်', align: TextAlign.right, style: head)],
                    ),
                    for (final (i, b) in r.bets.indexed)
                      TableRow(
                        decoration: BoxDecoration(color: i.isEven ? const Color(0xFFF4F3FF) : Colors.white),
                        children: [
                          cell('${i + 1}'),
                          cell(patternLabel(b.key), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                          cell('${b.unit.round()}', align: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        ],
                      ),
                  ],
                ),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx), child: const Text('ပြင်မည်')),
          FilledButton(onPressed: allGood ? () => Navigator.pop(dctx, true) : null, child: const Text('ထည့်မည်')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Same 0/00/000 top-to-bottom order in both 2D and 3D.
    final lastRowDigits = is3d ? ['0', '00', '000'] : ['0', '00', '-'];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        // Keys scale up with the sheet's actual width instead of a fixed 40/38px height —
        // otherwise every key looks tiny with lots of wasted space around it on a
        // wide/tablet-size screen, while staying exactly today's size on a normal phone.
        // They also scale DOWN when the sheet is capped shorter than the rows need (BetScreen
        // caps it against the screen height), so the last rows — ⌨ and Save — stay on screen
        // instead of sitting below its edge waiting to be scrolled to.
        child: LayoutBuilder(builder: (ctx, box) {
          var bigH = Responsive.scale(box.maxWidth, 47);
          var smallH = Responsive.scale(box.maxWidth, 45);
          var bigFont = Responsive.scale(box.maxWidth, 14);
          var smallFont = Responsive.scale(box.maxWidth, 15);
          if (box.maxHeight.isFinite) {
            // Everything in the sheet that is not a key row: its padding, the dock row, the
            // L/R/U toggles, the Number / Unit boxes, the gaps between the rows, and the
            // ⌨ / Save row at the bottom.
            const chrome = 227.0;
            final room = box.maxHeight - chrome;
            final need = smallH * 5 + bigH; // 5 rows of small keys + the အခွေ / ပြည့်ဂဏန်း row
            if (room > 0 && room < need) {
              // A floor keeps the keys tappable on a very short screen; past it the sheet
              // scrolls, as it always has.
              final fit = (room / need).clamp(0.72, 1.0);
              bigH *= fit;
              smallH *= fit;
              bigFont *= fit;
              smallFont *= fit;
            }
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 14),
            child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Dock toggle, top-left — pins the drawer open as BetScreen's persistent
              // Scaffold.bottomSheet (stays open across entries, doesn't block the sale table
              // behind it) instead of the default dismissible showModalBottomSheet. Nothing
              // drag-to-dismisses off of the old drag handle anyway (it was purely decorative).
              Row(
                children: [
                  IconButton(
                    icon: Icon(widget.docked ? Icons.push_pin : Icons.push_pin_outlined, size: 20, color: widget.docked ? _numberColor : Colors.grey),
                    tooltip: widget.docked ? 'Undock' : 'Dock',
                    onPressed: widget.onToggleDock,
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 32),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 12.5, fontWeight: FontWeight.w600)),
                ),
              // L/R/U quick-entry mode toggles, sitting above the ယူနစ် box — ported from the
              // desktop Sale page's own same-named toggles (see the state fields' own comment for
              // what each does); shown for both 2D and 3D since none of the three are digit-count
              // specific (R's <digits>R permutation pattern is valid either way).
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    // Lines up with the Number box below (same 45 / 55 split of the sheet, plus
                    // the 10px gap), so the three buttons sit directly above the Unit box
                    // instead of spanning the whole row.
                    const Spacer(flex: 1),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 1,
                      child: Row(children: [
                        Expanded(child: _modeToggle('L', sequentialEntry, _toggleSequentialEntry, 'Sequential sweep — ၀၀,၀၁,၀၂... auto')),
                        const SizedBox(width: 4),
                        Expanded(child: _modeToggle('R', rMode, _toggleRMode, 'R pattern only — ရိုက်လိုက်တာတိုင်း R အဖြစ် အလိုအလျောက် သိမ်း')),
                        const SizedBox(width: 4),
                        Expanded(child: _modeToggle('U', unitLocked, _toggleUnitLock, 'ယူနစ် သေအောင်ထား — ဂဏန်းပြည့်တာနဲ့ တန်း သိမ်း')),
                      ]),
                    ),
                  ],
                ),
              ),
              // The two boxes share the sheet's own width rather than being measured against the
              // whole screen, so neither runs past its edge on a narrow phone.
              Row(
                children: [
                  Expanded(child: _fieldBox(number, field == 'number', () => setState(() => field = 'number'), TextAlign.center)),
                  const SizedBox(width: 10),
                  Expanded(child: _fieldBox(unit, field == 'unit', () => setState(() => field = 'unit'), TextAlign.right)),
                ],
              ),
              const SizedBox(height: 6),
              // (The P/B/S/M row — 3D: T — is gone; those patterns stay in the အမြန် list, and
              // ဘရိတ် (B) has its own key just below. The other keys got taller to fill the space.)
              Row(children: [
                SmallKey(color: _kInk, text: 'အမြန်', textColor: Colors.white, onTap: _openQuickPatterns, height: smallH, fontSize: smallFont),
                SmallKey(color: _kIndigo, text: 'စီးရီး', textColor: Colors.white, onTap: _appendStar, height: smallH, fontSize: smallFont),
                // 2D: ဘရိတ် appends B (e.g. 5B = every number whose digits add up to 5); ပါဝါ (W)
                // and ကူး are in the အမြန် list. 3D keeps ကူး here since B doesn't apply there.
                is3d
                    ? SmallKey(color: _kIndigo, text: 'ကူး', textColor: Colors.white, onTap: _pasteBets, height: smallH, fontSize: smallFont)
                    : SmallKey(color: _kIndigo, text: 'ဘရိတ်', textColor: Colors.white, onTap: _appendB, height: smallH, fontSize: smallFont),
                SmallKey(color: _kViolet, text: 'ဖြတ်', textColor: Colors.white, onTap: _clearField, height: smallH, fontSize: smallFont),
              ]),
              const SizedBox(height: 3),
              // အခွေ / ပြည့်ဂဏန်း — see _openWheelDialog/_addAsPlain's own comments. ပြည့်ဂဏန်း also
              // carries the 3-second hold-to-submit-the-whole-sale shortcut (see _addThenSubmit).
              Row(children: [
                BigKey(color: _kViolet, text: 'အခွေ', textColor: Colors.white, onTap: _openWheelDialog, height: bigH, fontSize: bigFont),
                BigKey(
                  color: _kTeal,
                  text: 'ပြည့်ဂဏန်း',
                  textColor: Colors.white,
                  onTap: _addAsPlain,
                  onLongPress: _addThenSubmit,
                  longPressDuration: const Duration(seconds: 3),
                  height: bigH,
                  fontSize: bigFont,
                ),
              ]),
              const SizedBox(height: 3),
              Row(children: [
                SmallKey(color: Colors.white, text: '7', textColor: _kInk, onTap: () => _tapDigit('7'), height: smallH, fontSize: smallFont, bold: true),
                SmallKey(color: Colors.white, text: '8', textColor: _kInk, onTap: () => _tapDigit('8'), height: smallH, fontSize: smallFont, bold: true),
                SmallKey(color: Colors.white, text: '9', textColor: _kInk, onTap: () => _tapDigit('9'), height: smallH, fontSize: smallFont, bold: true),
                SmallKey(color: _kLavender, text: 'R', textColor: _kInk, onTap: _appendR, height: smallH, fontSize: smallFont, bold: true),
              ]),
              const SizedBox(height: 3),
              // ENTER spans the 4/5/6, 1/2/3 and 0/00/000 rows in the 4th column (where နက္ခက် used
              // to be). IntrinsicHeight gives `stretch` a real height — this Row sits inside the
              // sheet's SingleChildScrollView, which otherwise hands it an unbounded height.
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      flex: 3,
                      child: Column(children: [
                        for (final (i, keys) in [
                          ['4', '5', '6'],
                          ['1', '2', '3'],
                          lastRowDigits,
                        ].indexed) ...[
                          if (i > 0) const SizedBox(height: 3),
                          Row(children: [
                            for (final k in keys)
                              SmallKey(color: Colors.white, text: k, textColor: _kInk, onTap: () => k == '-' ? _appendMinus() : _tapDigit(k), height: smallH, fontSize: smallFont, bold: true),
                          ]),
                        ],
                      ]),
                    ),
                    Expanded(
                      flex: 1,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
                        child: Material(
                          color: _kInk,
                          borderRadius: BorderRadius.circular(10),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(10),
                            onTap: () {
                              SoundService.instance.enter();
                              // "25 -> ENTER -> unit -> ENTER" / "R -> ENTER -> unit -> ENTER": an ENTER
                              // while Unit is still empty just waits for the unit.
                              if (!sequentialEntry && number.isNotEmpty && field == 'unit' && unit.trim().isEmpty) {
                                setState(() => error = null);
                                return;
                              }
                              _add();
                            },
                            child: Center(child: Text('ENTER', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: smallFont))),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              // Bottom row: ⌨ hides the keypad (as before); Save saves the slip exactly like the sale
              // screen's ထိုးမည် button, and the keypad stays open for the next slip.
              Row(children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Material(
                      color: _kIndigo,
                      borderRadius: BorderRadius.circular(10),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: () => Navigator.of(context).pop(),
                        child: const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Icon(Icons.keyboard_alt_outlined, color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Material(
                      color: _kTeal,
                      borderRadius: BorderRadius.circular(10),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: _save,
                        child: const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Icon(Icons.save, color: Colors.white),
                            SizedBox(width: 6),
                            Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16)),
                          ]),
                        ),
                      ),
                    ),
                  ),
                ),
              ]),
            ],
            ),
          );
        }),
      ),
    );
  }
}
