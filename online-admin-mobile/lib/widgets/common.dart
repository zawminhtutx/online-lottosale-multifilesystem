import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../services/format.dart';

const brand = Color(0xFF4338CA); // indigo — the admin app's accent (the user app is violet)

// Admin, master and agent all sign into this one app, so each role gets its own look: the
// background, the accent and the dashboard header say at a glance which account is signed in.
//  - Admin  → indigo (the app's own colour)
//  - Master → rose
//  - Agent  → teal
class RoleLook {
  final Color seed; // the colour scheme's seed (buttons, accents)
  final Color scaffold; // page background
  final Color outer; // the band beside the app on tablets / landscape
  final List<Color> header; // the dashboard's header card gradient
  const RoleLook({required this.seed, required this.scaffold, required this.outer, required this.header});
}

const roleLooks = <String, RoleLook>{
  'admin': RoleLook(
    seed: brand,
    scaffold: Color(0xFFF1F5F9),
    outer: Color(0xFFE2E8F0),
    header: [Color(0xFF4338CA), Color(0xFF312E81)],
  ),
  'master': RoleLook(
    seed: Color(0xFFBE185D),
    scaffold: Color(0xFFFDF2F8),
    outer: Color(0xFFF6DFEA),
    header: [Color(0xFFBE185D), Color(0xFF831843)],
  ),
  'agent': RoleLook(
    seed: Color(0xFF0F766E),
    scaffold: Color(0xFFECFDF5),
    outer: Color(0xFFD3EFE7),
    header: [Color(0xFF0F766E), Color(0xFF115E59)],
  ),
};

RoleLook lookFor(String? role) => roleLooks[role] ?? roleLooks['admin']!;

void snack(BuildContext context, String message, {Color color = Colors.teal}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: color));
}

void errorSnack(BuildContext context, Object e) => snack(context, '$e', color: Colors.red);

Future<bool> confirm(BuildContext context, String title, {String? message, String ok = 'OK', bool danger = false}) async {
  final res = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: message == null ? null : Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Colors.red) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return res == true;
}

class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorView({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off, color: Colors.red, size: 40),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center, style: TextStyle(color: Colors.grey[700])),
            const SizedBox(height: 14),
            FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('ပြန်ကြိုးစားရန်')),
          ]),
        ),
      );
}

class EmptyView extends StatelessWidget {
  final String text;
  final IconData icon;
  const EmptyView(this.text, {super.key, this.icon = Icons.inbox_outlined});

  @override
  Widget build(BuildContext context) => ListView(children: [
        const SizedBox(height: 100),
        Icon(icon, size: 48, color: Colors.grey[400]),
        const SizedBox(height: 8),
        Center(child: Text(text, style: TextStyle(color: Colors.grey[600]))),
      ]);
}

// Loads with [load]; shows spinner / error / [builder]; pull to refresh.
class Loader<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  const Loader({super.key, required this.load, required this.builder});

  @override
  State<Loader<T>> createState() => LoaderState<T>();
}

class LoaderState<T> extends State<Loader<T>> {
  T? data;
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    if (data == null) setState(() => loading = true);
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        data = d;
        error = null;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = '$e';
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading && data == null) return const Center(child: CircularProgressIndicator());
    if (error != null && data == null) return ErrorView(message: error!, onRetry: reload);
    return RefreshIndicator(onRefresh: reload, child: widget.builder(context, data as T, reload));
  }
}

class SectionCard extends StatelessWidget {
  final String? title;
  final Widget? trailing;
  final List<Widget> children;
  final EdgeInsets padding;
  const SectionCard({super.key, this.title, this.trailing, required this.children, this.padding = const EdgeInsets.all(14)});

  @override
  Widget build(BuildContext context) => Card(
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.grey.shade200)),
        child: Padding(
          padding: padding,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(children: [
                  Expanded(child: Text(title!, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5))),
                  ?trailing,
                ]),
              ),
            ...children,
          ]),
        ),
      );
}

// A date + time picker field holding a local DateTime (sent to the server as UTC ISO).
class DateTimeField extends StatelessWidget {
  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  final bool enabled;
  const DateTimeField({super.key, required this.label, required this.value, required this.onChanged, this.enabled = true});

  static final _fmt = DateFormat('dd-MM-yyyy  hh:mm a');

  Future<void> _pick(BuildContext context) async {
    final start = value ?? DateTime.now();
    // Calendar only: the typed-entry mode would ask for the phone locale's format (mm/dd/yyyy).
    final d = await showDatePicker(
        context: context, initialDate: start, firstDate: DateTime(2020), lastDate: DateTime(2100), initialEntryMode: DatePickerEntryMode.calendarOnly);
    if (d == null || !context.mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(start));
    if (t == null) return;
    onChanged(DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: enabled ? () => _pick(context) : null,
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            isDense: true,
            enabled: enabled,
            suffixIcon: value != null && enabled
                ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => onChanged(null))
                : const Icon(Icons.event, size: 18),
          ),
          child: Text(value == null ? '—' : _fmt.format(value!)),
        ),
      );
}

String? isoUtc(DateTime? local) => local?.toUtc().toIso8601String();

(String, Color) termStatusOf(Object? s) => termStatusAll['$s'] ?? ('$s', Colors.grey);

const termStatusAll = <String, (String, Color)>{
  'draft': ('Active မလုပ်ရသေး', Color(0xFF64748B)), // auto terms; users can't see them yet
  'open': ('ဖွင့်ထား', Color(0xFF2563EB)),
  'closed': ('ပိတ်ပြီး', Color(0xFF475569)),
  'drawn': ('ဂဏန်းထွက်ပြီး', Color(0xFFD97706)),
  'settled': ('ငွေရှင်းပြီး', Color(0xFF059669)),
  'cancelled': ('ပယ်ဖျက်', Color(0xFFDC2626)),
};

// Unit per number: the badge for a term row / header.
Widget termBadge(Object? status) {
  final (label, color) = termStatusOf(status);
  return StatusChip(label, color);
}

// ---------------------------------------------------------------- Responsive layout
// Phones: one column, full width. Tablets / landscape: content stays readable — the whole app is
// held to a centred maxWidth (see main.dart), forms to a narrower width, and lists flow into 2-3
// columns (AdaptiveListView).

// Centres [child] and keeps it at most [maxWidth] wide (forms, settings tabs).
class ContentWidth extends StatelessWidget {
  final double maxWidth;
  final Widget child;
  const ContentWidth({super.key, this.maxWidth = 720, required this.child});

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child),
      );
}

// A list that becomes a grid on wide screens: as many columns as fit items at least
// [minItemWidth] wide (1 on a phone, up to [maxColumns]). Rows take the height of their tallest
// card, so cards of different heights still line up.
class AdaptiveListView extends StatelessWidget {
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;
  final EdgeInsetsGeometry padding;
  final double minItemWidth;
  final int maxColumns;
  final double spacing;
  final ScrollPhysics? physics;
  const AdaptiveListView({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    this.padding = const EdgeInsets.all(12),
    this.minItemWidth = 360,
    this.maxColumns = 3,
    this.spacing = 8,
    this.physics,
  });

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (ctx, box) {
        final inner = box.maxWidth - padding.horizontal;
        final cols = (inner / minItemWidth).floor().clamp(1, maxColumns);
        final rows = (itemCount / cols).ceil();
        return ListView.builder(
          padding: padding,
          physics: physics,
          itemCount: rows,
          itemBuilder: (ctx, r) => Padding(
            padding: EdgeInsets.only(bottom: r == rows - 1 ? 0 : spacing),
            child: cols == 1
                ? itemBuilder(ctx, r)
                : IntrinsicHeight(
                    child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      for (var c = 0; c < cols; c++) ...[
                        if (c > 0) SizedBox(width: spacing),
                        Expanded(child: r * cols + c < itemCount ? itemBuilder(ctx, r * cols + c) : const SizedBox.shrink()),
                      ],
                    ]),
                  ),
          ),
        );
      });
}
