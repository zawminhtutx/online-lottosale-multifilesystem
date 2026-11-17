import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../services/company.dart';
import '../services/printer_service.dart';
import '../widgets/dash_style.dart';
import '../widgets/responsive_layout.dart';

// Bluetooth Printer — pick a paired thermal printer, paper, layout (two-column, margins,
// text align, footer) and preview / test-print the sample slip.
class PrinterSettingsScreen extends StatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  State<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends State<PrinterSettingsScreen> {
  PrinterSettings? settings;
  final _header = TextEditingController();
  final _footer = TextEditingController();
  bool busy = false;

  @override
  void initState() {
    super.initState();
    PrinterSettings.load().then((s) {
      _header.text = s.header;
      _footer.text = s.footer;
      if (mounted) setState(() => settings = s);
    });
  }

  @override
  void dispose() {
    _header.dispose();
    _footer.dispose();
    super.dispose();
  }

  Future<void> _save(PrinterSettings next) async {
    await next.save();
    if (mounted) setState(() => settings = next);
  }

  Future<void> _pickPrinter() async {
    List devices;
    try {
      devices = await PrinterService.pairedDevices();
    } catch (e) {
      _snack('$e', Colors.red);
      return;
    }
    if (!mounted) return;
    if (devices.isEmpty) {
      _snack('Pair လုပ်ထားသော printer မရှိပါ — ဖုန်း Bluetooth settings မှာ printer ကို အရင် pair လုပ်ပါ', Colors.orange);
      return;
    }
    final picked = await showModalBottomSheet<dynamic>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.all(14), child: Text('Printer ရွေးပါ', style: TextStyle(fontWeight: FontWeight.w800))),
          for (final d in devices)
            ListTile(
              leading: const Icon(Icons.print),
              title: Text(d.name),
              subtitle: Text(d.macAdress),
              onTap: () => Navigator.pop(ctx, d),
            ),
        ]),
      ),
    );
    if (picked == null) return;
    await _save(settings!.copyWith(name: picked.name as String, mac: picked.macAdress as String));
    setState(() => busy = true);
    final ok = await PrinterService.connect(picked.macAdress as String).catchError((_) => false);
    if (mounted) setState(() => busy = false);
    _snack(ok ? 'Printer ချိတ်ဆက်ပြီးပါပြီ ✅' : 'ချိတ်ဆက်၍မရပါ — printer ဖွင့်ထားပြီး အနီးတွင် ရှိမရှိ စစ်ပါ', ok ? Colors.teal : Colors.red);
  }

  Future<void> _openPreview() async {
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PrintPreviewScreen(settings: settings!)));
    final s = await PrinterSettings.load();
    _header.text = s.header;
    _footer.text = s.footer;
    if (mounted) setState(() => settings = s);
  }

  void _snack(String message, Color color) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: color));
  }

  Widget _card({required List<Widget> children}) => Card(
        elevation: 0,
        color: Colors.white,
        surfaceTintColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      );

  Widget _marginSlider(String label, int value, ValueChanged<int> onChanged) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label  $value', style: const TextStyle(fontWeight: FontWeight.w700)),
          Slider(
            min: 0,
            max: 40,
            divisions: 40,
            value: value.toDouble().clamp(0, 40),
            label: '$value',
            onChanged: (v) => onChanged(v.round()),
          ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final s = settings;
    return DashScaffold(
      title: const Text('🖨️ Bluetooth Printer', style: TextStyle(fontWeight: FontWeight.w700)),
      body: s == null
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : ContentWidth(
              maxWidth: 720,
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
                _card(children: [
                  const Text('Printer', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(s.hasPrinter ? '${s.name}\n${s.mac}' : 'ရွေးချယ်ထားခြင်း မရှိသေးပါ', style: TextStyle(color: Colors.grey[700])),
                  const SizedBox(height: 10),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: Dash.ink),
                      onPressed: busy ? null : _pickPrinter,
                      icon: const Icon(Icons.bluetooth_searching),
                      label: Text(s.hasPrinter ? 'Printer ပြောင်းရန်' : 'Printer ရွေးရန်'),
                    ),
                    OutlinedButton.icon(onPressed: busy ? null : _openPreview, icon: const Icon(Icons.visibility_outlined), label: const Text('Print Preview')),
                    if (s.hasPrinter)
                      TextButton(onPressed: busy ? null : () => _save(s.copyWith(clearPrinter: true)), child: const Text('ဖယ်ရှားရန်')),
                  ]),
                  if (busy) const Padding(padding: EdgeInsets.only(top: 10), child: LinearProgressIndicator()),
                ]),
                _card(children: [
                  const Text('စက္ကူ အကျယ်', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  SegmentedButton<int>(
                    segments: const [ButtonSegment(value: 58, label: Text('58 mm')), ButtonSegment(value: 80, label: Text('80 mm'))],
                    selected: {s.paperMm},
                    showSelectedIcon: false,
                    onSelectionChanged: (v) => _save(s.copyWith(paperMm: v.first)),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _header,
                    decoration: InputDecoration(
                        labelText: 'စလစ် ခေါင်းစဥ် (ဆိုင်အမည်)',
                        hintText: Company.slipHeader(),
                        helperText: 'မဖြည့်လျှင် ${Company.slipHeader()} ကို သုံးမည်',
                        border: const OutlineInputBorder(),
                        isDense: true),
                    onChanged: (v) => _save(s.copyWith(header: v.trim())),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _footer,
                    decoration: const InputDecoration(
                        labelText: 'Footer text',
                        hintText: '— Thank you —',
                        border: OutlineInputBorder(),
                        isDense: true),
                    onChanged: (v) => _save(s.copyWith(footer: v)),
                  ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Two column ထုတ်မည်', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('ဂဏန်းနှစ်လုံးကို တစ်ကြောင်းတည်းတွင် ပြမည်'),
                    value: s.twoColumn,
                    onChanged: (v) => _save(s.copyWith(twoColumn: v ?? false)),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('ထိုးပြီးတာနဲ့ ပရင့်ထုတ်မည်', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('ထိုးမည် နှိပ်ပြီး slip ကို အလိုအလျောက် ပုံနှိပ်မည်'),
                    value: s.printOnSave,
                    onChanged: (v) => _save(s.copyWith(printOnSave: v)),
                  ),
                ]),
                _card(children: [
                  const Text('Printer alignment', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text('စလစ်တစ်ခုလုံးကို ဘယ် / ညာ ရွှေ့ရန်', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
                  _marginSlider('ဘယ်ဘက် (Left)', s.padLeft, (v) => _save(s.copyWith(padLeft: v))),
                  _marginSlider('ညာဘက် (Right)', s.padRight, (v) => _save(s.copyWith(padRight: v))),
                  const SizedBox(height: 6),
                  const Text('Print text alignment', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'left', label: Text('Left'), icon: Icon(Icons.format_align_left, size: 18)),
                      ButtonSegment(value: 'center', label: Text('Center'), icon: Icon(Icons.format_align_center, size: 18)),
                      ButtonSegment(value: 'right', label: Text('Right'), icon: Icon(Icons.format_align_right, size: 18)),
                    ],
                    selected: {s.textAlign},
                    showSelectedIcon: false,
                    onSelectionChanged: (v) => _save(s.copyWith(textAlign: v.first)),
                  ),
                ]),
              ]),
            ),
    );
  }
}

class PrintPreviewScreen extends StatefulWidget {
  final PrinterSettings settings;
  const PrintPreviewScreen({super.key, required this.settings});

  @override
  State<PrintPreviewScreen> createState() => _PrintPreviewScreenState();
}

class _PrintPreviewScreenState extends State<PrintPreviewScreen> {
  Uint8List? png;
  String? error;
  bool printing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final bytes = await PrinterService.previewPng(widget.settings);
      if (mounted) setState(() => png = bytes);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _testPrint() async {
    setState(() => printing = true);
    try {
      await PrinterService.testPrint();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('စမ်းသပ် ပုံနှိပ်ပြီးပါပြီ'), backgroundColor: Colors.teal));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => printing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DashScaffold(
      title: const Text('Print Preview', style: TextStyle(fontWeight: FontWeight.w700)),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Dash.ink),
            onPressed: printing ? null : _testPrint,
            icon: printing
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.print),
            label: const Text('Test Print'),
          ),
        ),
      ],
      body: error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, style: const TextStyle(color: Colors.white))))
          : png == null
              ? const Center(child: CircularProgressIndicator(color: Colors.white))
              : ListView(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
                  children: [
                    Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 360),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 12, offset: Offset(0, 4))],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.memory(png!, filterQuality: FilterQuality.none, fit: BoxFit.fitWidth),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Dash.ink, minimumSize: const Size.fromHeight(48)),
                      onPressed: printing ? null : _testPrint,
                      icon: const Icon(Icons.print),
                      label: const Text('Test Print'),
                    ),
                  ],
                ),
    );
  }
}
