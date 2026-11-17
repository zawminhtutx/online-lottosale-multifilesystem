import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

// Server timestamps are UTC: SQLite's "YYYY-MM-DD HH:MM:SS" (created_at) or ISO strings (open_at,
// close_at, draw_at). Shown in the phone's local time.
DateTime? parseDate(Object? value) {
  if (value == null) return null;
  final s = '$value';
  if (s.isEmpty) return null;
  final iso = s.contains('T') ? s : '${s.replaceFirst(' ', 'T')}Z';
  return DateTime.tryParse(iso)?.toLocal();
}

final _dateTimeFmt = DateFormat('dd-MM-yyyy hh:mm a'); // dd-mm-yyyy like the web dashboard
final _timeFmt = DateFormat('hh:mm a');
String dateTime(Object? value) {
  final d = parseDate(value);
  return d == null ? '-' : _dateTimeFmt.format(d);
}

String timeOnly(Object? value) {
  final d = parseDate(value);
  return d == null ? '-' : _timeFmt.format(d);
}

// "2 နာရီ 5 မိနစ်" until [value], or null once it has passed.
String? timeLeft(Object? value, [DateTime? now]) {
  final d = parseDate(value);
  if (d == null) return null;
  final left = d.difference(now ?? DateTime.now());
  if (left.isNegative) return null;
  final h = left.inHours;
  final m = left.inMinutes % 60;
  return h > 0 ? '$h နာရီ $m မိနစ်' : '$m မိနစ်';
}

// Open for betting right now: status open and inside its Ledger (open_at) .. close_at window.
bool isTermOpen(Map term, [DateTime? now]) {
  if (term['status'] != 'open') return false;
  final at = now ?? DateTime.now();
  final opens = parseDate(term['open_at']);
  final closes = parseDate(term['close_at']);
  if (opens != null && at.isBefore(opens)) return false;
  return closes == null || at.isBefore(closes);
}

const ticketStatus = <String, (String, Color)>{
  'active': ('စောင့်ဆိုင်းဆဲ', Color(0xFF2563EB)),
  'won': ('ပေါက်', Color(0xFF059669)),
  'lost': ('မပေါက်', Color(0xFF64748B)),
  'cancelled': ('ပယ်ဖျက်', Color(0xFFDC2626)),
};

const termStatus = <String, (String, Color)>{
  'open': ('ဖွင့်ထား', Color(0xFF2563EB)),
  'closed': ('ပိတ်ပြီး', Color(0xFF64748B)),
  'drawn': ('ဂဏန်းထွက်ပြီး', Color(0xFFD97706)),
  'settled': ('ငွေရှင်းပြီး', Color(0xFF059669)),
};

// Twod (တွဒ်) numbers of a 3D result — same rule as the server: the +1/-1 neighbours (wrapping
// 999 <-> 000) and every other ordering of its digits.
List<String> twodNumbers(String? r3) {
  if (r3 == null || !RegExp(r'^\d{3}$').hasMatch(r3)) return const [];
  final n = int.parse(r3);
  final out = <String>[];
  final seen = <String>{r3};
  void add(String x) {
    if (seen.add(x)) out.add(x);
  }

  add(((n + 1) % 1000).toString().padLeft(3, '0'));
  add(((n + 999) % 1000).toString().padLeft(3, '0'));
  void permute(String rest, String prefix) {
    if (rest.isEmpty) return add(prefix);
    for (var i = 0; i < rest.length; i++) {
      permute(rest.substring(0, i) + rest.substring(i + 1), prefix + rest[i]);
    }
  }

  permute(r3, '');
  return out;
}

// 2D / 3D badge circle, as on the POS mobile app's term lists.
class GameCircle extends StatelessWidget {
  final String game;
  final double radius;
  const GameCircle(this.game, {super.key, this.radius = 22});

  @override
  Widget build(BuildContext context) {
    final is3d = game == '3D';
    return CircleAvatar(
      radius: radius,
      backgroundColor: is3d ? const Color(0xFF7C3AED) : const Color(0xFF0EA5E9),
      child: Text(is3d ? '3D' : '2D', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: radius * .6)),
    );
  }
}

class StatusChip extends StatelessWidget {
  final String label;
  final Color color;
  const StatusChip(this.label, this.color, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11.5)),
    );
  }
}

// Numbers and units (ဂဏန်း / ယူနစ်) in Poppins Light 300 — bundled in assets/fonts (see pubspec.yaml).
// Myanmar text in the same string falls back to the system font.
TextStyle numberStyle({double? fontSize, Color? color}) =>
    TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w300, fontSize: fontSize, color: color);

// The server stamps can_manage on a file, term or prize set the signed-in account may change.
// Admin manages every book. A master manages only its own. A missing flag is treated as allowed.
bool manages(Map? row) {
  final v = row?['can_manage'];
  return v != false && v != 0;
}
