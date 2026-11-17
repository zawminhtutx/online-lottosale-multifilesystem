import 'package:flutter/material.dart';

import '../services/format.dart';

// A small numeric/symbol/action key in the pattern keypad drawer's grid.
class SmallKey extends StatelessWidget {
  final Color color;
  final String text;
  final Color textColor;
  final VoidCallback? onTap;
  // Scales up on wide screens (tablets/large phones) — see pattern_keypad_sheet.dart's build(),
  // which computes this from the available width so the keypad doesn't look tiny on a big screen.
  final double height;
  final double fontSize;
  // Number keys and R are bold (Poppins Bold); every other key stays Poppins Light.
  final bool bold;
  const SmallKey({super.key, required this.color, required this.text, required this.textColor, this.onTap, this.height = 38, this.fontSize = 15, this.bold = false});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
        child: Material(
          color: color,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Container(
              height: height,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFDCDAF7))),
              alignment: Alignment.center,
              // Keypad keys in Poppins Light 300, or Bold for number keys and R (Myanmar labels
              // fall back to the system font).
              child: Text(text,
                  style: bold
                      ? TextStyle(fontFamily: 'PoppinsBold', fontWeight: FontWeight.w700, color: textColor, fontSize: fontSize)
                      : numberStyle(color: textColor, fontSize: fontSize)),
            ),
          ),
        ),
      ),
    );
  }
}
