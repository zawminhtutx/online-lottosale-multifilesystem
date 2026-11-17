import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../services/format.dart';

// The large P/B/ပြည့်ဂဏန်း buttons in the pattern keypad drawer.
class BigKey extends StatelessWidget {
  final Color color;
  final String text;
  final Color textColor;
  final VoidCallback? onTap;
  // Optional custom-duration long-press (see pattern_keypad_sheet.dart's ပြည့်ဂဏန်း key, which
  // reuses this for its own hold-to-submit-the-whole-sale shortcut, formerly on the now-removed
  // ထိုးမည် button) — InkWell's own built-in onLongPress can't lengthen its ~500ms default, so
  // this needs the same RawGestureDetector + LongPressGestureRecognizer approach that button used,
  // just moved inside here so Expanded (required directly under this widget's parent Row) stays
  // the outermost widget either way. A plain tap still reaches onTap normally — the two
  // recognizers compete in the same gesture arena, and InkWell's own tap is rejected only once
  // the long-press actually wins.
  final VoidCallback? onLongPress;
  final Duration longPressDuration;
  // Scales up on wide screens (tablets/large phones) — see pattern_keypad_sheet.dart's build(),
  // which computes this from the available width so the keypad doesn't look tiny on a big screen.
  final double height;
  final double fontSize;
  const BigKey({
    super.key,
    required this.color,
    required this.text,
    required this.textColor,
    this.onTap,
    this.onLongPress,
    this.longPressDuration = const Duration(milliseconds: 500),
    this.height = 40,
    this.fontSize = 14,
  });

  @override
  Widget build(BuildContext context) {
    Widget child = InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: SizedBox(
        height: height,
        // Keypad keys in Poppins Light 300 (Myanmar labels fall back to the system font).
        child: Center(child: Text(text, style: numberStyle(color: textColor, fontSize: fontSize))),
      ),
    );
    if (onLongPress != null) {
      child = RawGestureDetector(
        gestures: {
          LongPressGestureRecognizer: GestureRecognizerFactoryWithHandlers<LongPressGestureRecognizer>(
            () => LongPressGestureRecognizer(duration: longPressDuration),
            (instance) => instance.onLongPress = onLongPress,
          ),
        },
        child: child,
      );
    }
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Material(
          color: color,
          borderRadius: BorderRadius.circular(10),
          child: child,
        ),
      ),
    );
  }
}
