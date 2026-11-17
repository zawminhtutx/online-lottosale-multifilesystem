import 'package:flutter/material.dart';

// The indigo "Daily Rewards" look shared by the dashboard and the profile screen: a gradient
// background, glass cards (translucent white with a thin light border) and a light lavender
// highlight with dark navy text / pill buttons.
class Dash {
  static const top = Color(0xFF5B5BD6);
  static const bottom = Color(0xFF3B37B5);
  static const ink = Color(0xFF1E1B4B); // dark navy: text and pill buttons on the light highlight
  static const highlight = LinearGradient(
      begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFEEF0FF), Color(0xFFC9C7F4)]);
  static final glass = Colors.white.withValues(alpha: .10);
  static final glassBorder = Colors.white.withValues(alpha: .28);
  // Text colours that stay readable on the indigo background.
  static const green = Color(0xFF6EE7B7);
  static const red = Color(0xFFFCA5A5);
  static const amber = Color(0xFFFCD34D);

  static BoxDecoration glassBox({double radius = 22}) => BoxDecoration(
        color: glass,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: glassBorder, width: 1.2),
      );
}

// Glass text field / dropdown decoration on the indigo background (pair with white text).
InputDecoration dashInput(String label, {IconData? icon, Widget? suffix}) {
  OutlineInputBorder border(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: c, width: 1.2));
  return InputDecoration(
    labelText: label,
    labelStyle: const TextStyle(color: Colors.white70),
    floatingLabelStyle: const TextStyle(color: Colors.white),
    prefixIcon: icon == null ? null : Icon(icon, color: Colors.white70),
    suffixIcon: suffix,
    isDense: icon == null,
    filled: true,
    fillColor: Dash.glass,
    enabledBorder: border(Dash.glassBorder),
    focusedBorder: border(Colors.white),
  );
}

// Scaffold with the gradient behind a transparent app bar (white title and icons).
class DashScaffold extends StatelessWidget {
  final Widget? title;
  final List<Widget>? actions;
  final Widget body;
  const DashScaffold({super.key, this.title, this.actions, required this.body});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Dash.bottom,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: title,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        actions: actions,
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Dash.top, Dash.bottom]),
        ),
        child: SafeArea(bottom: false, child: body),
      ),
    );
  }
}

// Rounded-square glass icon button (like the reference's ← button).
// Like GlassIconButton, with the name beside the icon — for the one or two actions on a screen
// that should read as words rather than a symbol (the Sale screen's စလစ်).
class GlassButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  const GlassButton({super.key, required this.icon, required this.label, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: .18),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 7, 12, 7),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13.5)),
          ]),
        ),
      ),
    );
  }
}

class GlassIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  const GlassIconButton({super.key, required this.icon, required this.tooltip, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white.withValues(alpha: .18),
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onPressed,
          child: Padding(padding: const EdgeInsets.all(9), child: Icon(icon, color: Colors.white, size: 22)),
        ),
      ),
    );
  }
}
