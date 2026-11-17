import 'package:flutter/material.dart';

import '../services/format.dart';

class DisplayText extends StatelessWidget {
  final String text;
  // Number field centers its value, Unit field right-aligns (matches a plain numeric-entry
  // field's usual convention) — see pattern_keypad_sheet.dart's _fieldBox call sites.
  final TextAlign textAlign;

  const DisplayText({super.key, required this.text, this.textAlign = TextAlign.center});

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFF4F46E5), width: 1.2),
        borderRadius: BorderRadius.circular(10),
      ),
      // A width for where this is used on its own; inside the keypad's Number / Unit row it sits
      // in an Expanded, which hands it the share of the sheet it gets (the box used to be sized
      // against the whole screen, so the Unit one ran past the sheet's edge on a phone).
      width: size.width * 0.45,
      // `text` is always two lines ("label\nvalue" — see pattern_keypad_sheet.dart's
      // _fieldBox) — a fixed height here (this used to be size.height * 0.05, only ~100px of
      // usable space after padding on a typical phone) clips the second line, so a typed
      // number/unit value could overflow past the visible box and disappear even though it's
      // still held correctly in state. Sizing to the text's own natural height avoids that
      // regardless of screen size or font scaling.
      child: Text(
        text,
        textAlign: textAlign,
        style: numberStyle(fontSize: 18, color: const Color(0xFF1E1B4B)), // Poppins Light: number / unit being typed
      ),
    );
  }
}
