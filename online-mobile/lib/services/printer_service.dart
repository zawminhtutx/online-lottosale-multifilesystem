import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:esc_pos_utils_plus/esc_pos_utils_plus.dart';
import 'package:flutter/painting.dart';
import 'package:image/image.dart' as img;
import 'package:intl/intl.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'company.dart';
import 'format.dart';
import 'pattern_parser.dart';
import 'slip_text.dart';

// Bluetooth slip printer — same approach as the POS mobile app (printer_service.dart there): the
// slip is drawn as an image (so Myanmar text prints on any ESC/POS printer) and sent raster.
class PrinterException implements Exception {
  final String message;
  PrinterException(this.message);
  @override
  String toString() => message;
}

// Printer choice and slip options, kept on this phone.
class PrinterSettings {
  final String? name;
  final String? mac;
  final int paperMm; // 58 or 80
  final String header; // shop name on top of the slip; empty = the company name (see company.dart)
  final String footer;
  final bool twoColumn;
  final int padLeft; // dots from the left paper edge
  final int padRight; // dots from the right paper edge
  final String textAlign; // left | center | right — header, lines, footer
  final bool printOnSave;
  const PrinterSettings({
    this.name,
    this.mac,
    this.paperMm = 58,
    this.header = '',
    this.footer = '',
    this.twoColumn = false,
    this.padLeft = 14,
    this.padRight = 14,
    this.textAlign = 'left',
    this.printOnSave = false,
  });

  PosAlign get posAlign => switch (textAlign) {
        'center' => PosAlign.center,
        'right' => PosAlign.right,
        _ => PosAlign.left,
      };

  bool get hasPrinter => mac != null && mac!.isNotEmpty;

  static Future<PrinterSettings> load() async {
    final p = await SharedPreferences.getInstance();
    return PrinterSettings(
      name: p.getString('printer_name'),
      mac: p.getString('printer_mac'),
      paperMm: p.getInt('printer_paper') ?? 58,
      header: p.getString('printer_header') ?? '',
      footer: p.getString('printer_footer') ?? '',
      twoColumn: p.getBool('printer_two_column') ?? false,
      padLeft: p.getInt('printer_pad_left') ?? 14,
      padRight: p.getInt('printer_pad_right') ?? 14,
      textAlign: p.getString('printer_text_align') ?? 'left',
      printOnSave: p.getBool('printer_on_save') ?? false,
    );
  }

  Future<void> save() async {
    final p = await SharedPreferences.getInstance();
    if (hasPrinter) {
      await p.setString('printer_name', name ?? '');
      await p.setString('printer_mac', mac!);
    } else {
      await p.remove('printer_name');
      await p.remove('printer_mac');
    }
    await p.setInt('printer_paper', paperMm);
    await p.setString('printer_header', header);
    await p.setString('printer_footer', footer);
    await p.setBool('printer_two_column', twoColumn);
    await p.setInt('printer_pad_left', padLeft);
    await p.setInt('printer_pad_right', padRight);
    await p.setString('printer_text_align', textAlign);
    await p.setBool('printer_on_save', printOnSave);
  }

  PrinterSettings copyWith({
    String? name,
    String? mac,
    bool clearPrinter = false,
    int? paperMm,
    String? header,
    String? footer,
    bool? twoColumn,
    int? padLeft,
    int? padRight,
    String? textAlign,
    bool? printOnSave,
  }) =>
      PrinterSettings(
        name: clearPrinter ? null : name ?? this.name,
        mac: clearPrinter ? null : mac ?? this.mac,
        paperMm: paperMm ?? this.paperMm,
        header: header ?? this.header,
        footer: footer ?? this.footer,
        twoColumn: twoColumn ?? this.twoColumn,
        padLeft: padLeft ?? this.padLeft,
        padRight: padRight ?? this.padRight,
        textAlign: textAlign ?? this.textAlign,
        printOnSave: printOnSave ?? this.printOnSave,
      );
}

class _Ticket {
  static const _black = Color(0xFF000000);
  static const _white = Color(0xFFFFFFFF);

  final double width; // dots: 384 for 58mm, 576 for 80mm (203dpi heads)
  final double padLeft;
  final double padRight;
  final PosAlign textAlign;
  final ui.PictureRecorder _recorder = ui.PictureRecorder();
  late final Canvas _canvas;
  double _y;

  _Ticket(this.width, {this.padLeft = 14, this.padRight = 14, this.textAlign = PosAlign.left}) : _y = padLeft {
    _canvas = Canvas(_recorder);
    _canvas.drawRect(Rect.fromLTWH(0, 0, width, 8000), Paint()..color = _white);
  }

  double get _inner => (width - padLeft - padRight).clamp(40, width);

  TextPainter _layout(String text, double fontSize, bool bold, double maxWidth, {int maxLines = 4}) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: TextStyle(fontSize: fontSize, fontWeight: bold ? FontWeight.bold : FontWeight.normal, color: _black)),
      textDirection: ui.TextDirection.ltr,
      maxLines: maxLines,
      ellipsis: '…',
    );
    tp.layout(maxWidth: maxWidth);
    return tp;
  }

  void text(String s, {double size = 24, bool bold = false, PosAlign? align, double gap = 8}) {
    final a = align ?? textAlign;
    final tp = _layout(s, size, bold, _inner);
    var dx = padLeft;
    if (a == PosAlign.center) dx = padLeft + (_inner - tp.width) / 2;
    if (a == PosAlign.right) dx = width - padRight - tp.width;
    tp.paint(_canvas, Offset(dx, _y));
    _y += tp.height + gap;
  }

  // "label ........ value" on one line.
  void pair(String left, String right, {double size = 24, bool bold = false, double gap = 6}) {
    final l = _layout(left, size, bold, _inner);
    final r = _layout(right, size, bold, _inner);
    l.paint(_canvas, Offset(padLeft, _y));
    r.paint(_canvas, Offset(width - padRight - r.width, _y));
    _y += (l.height > r.height ? l.height : r.height) + gap;
  }

  // One or two "label .... unit" slots on a row, matching the web two-column slip.
  void itemSlots(List<({String label, String unit})> slots, {double size = 24, bool bold = true, double gap = 4}) {
    if (slots.isEmpty) return;
    final two = slots.length > 1;
    final gapPx = two ? 10.0 : 0.0;
    final slotW = two ? (_inner - gapPx) / 2 : _inner;
    double height = 0;
    for (var i = 0; i < slots.length; i++) {
      final left = padLeft + i * (slotW + gapPx);
      final right = left + slotW;
      final unitTp = _layout(slots[i].unit, size, bold, slotW * .45, maxLines: 1);
      final labelW = (slotW - unitTp.width - 6).clamp(16.0, slotW);
      final labelTp = _layout(slots[i].label, size, bold, labelW, maxLines: 1);
      labelTp.paint(_canvas, Offset(left, _y));
      unitTp.paint(_canvas, Offset(right - unitTp.width, _y));
      final h = labelTp.height > unitTp.height ? labelTp.height : unitTp.height;
      if (h > height) height = h;
    }
    if (two) {
      final mid = padLeft + slotW + gapPx / 2;
      final bar = _layout('|', size, false, 16, maxLines: 1);
      bar.paint(_canvas, Offset(mid - bar.width / 2, _y));
    }
    _y += height + gap;
  }

  void hr({double gap = 10}) {
    _canvas.drawLine(Offset(padLeft, _y), Offset(width - padRight, _y), Paint()
      ..color = _black
      ..strokeWidth = 1.6);
    _y += gap;
  }

  Future<img.Image> finish() async {
    final h = (_y + padLeft).ceil().clamp(1, 8000);
    final picture = _recorder.endRecording();
    final uiImage = await picture.toImage(width.toInt(), h);
    final byteData = await uiImage.toByteData(format: ui.ImageByteFormat.rawRgba);
    return img.Image.fromBytes(width: width.toInt(), height: h, bytes: byteData!.buffer, numChannels: 4, order: img.ChannelOrder.rgba);
  }
}

class PrinterService {
  static Future<bool> _ensurePermission() async {
    final statuses = await [Permission.bluetoothConnect, Permission.bluetoothScan].request();
    return statuses.values.every((s) => s.isGranted);
  }

  static Future<List<BluetoothInfo>> pairedDevices() async {
    if (!await _ensurePermission()) throw PrinterException('Bluetooth ခွင့်ပြုချက် လိုအပ်ပါတယ်');
    return PrintBluetoothThermal.pairedBluetooths;
  }

  static Future<bool> connect(String mac) async {
    await _ensurePermission();
    if (await PrintBluetoothThermal.connectionStatus) await PrintBluetoothThermal.disconnect;
    return PrintBluetoothThermal.connect(macPrinterAddress: mac);
  }

  static Future<PrinterSettings> _ready() async {
    final s = await PrinterSettings.load();
    if (!s.hasPrinter) throw PrinterException('ကိုယ်ရေးအချက်အလက် > Bluetooth Printer မှာ printer အရင်ရွေးပါ');
    if (!await _ensurePermission()) throw PrinterException('Bluetooth ခွင့်ပြုချက် လိုအပ်ပါတယ်');
    if (!await PrintBluetoothThermal.connectionStatus && !await PrintBluetoothThermal.connect(macPrinterAddress: s.mac!)) {
      throw PrinterException('Printer (${s.name}) နှင့် ချိတ်ဆက်လို့မရပါ');
    }
    return s;
  }

  static Future<void> _send(PrinterSettings s, img.Image image) async {
    final gen = Generator(s.paperMm == 80 ? PaperSize.mm80 : PaperSize.mm58, await CapabilityProfile.load());
    final bytes = <int>[...gen.reset(), ...gen.imageRaster(image), ...gen.feed(2), ...gen.cut()];
    if (!await PrintBluetoothThermal.writeBytes(bytes)) throw PrinterException('ပရင့်ထုတ်ခြင်း မအောင်မြင်ပါ');
  }

  static final _moneyFmt = NumberFormat('#,##0');
  static String defaultMoney(num v) => _moneyFmt.format(v);

  static Map<String, dynamic> sampleTicket() => {
        'term_description': 'Preview PM',
        'term_id': 1,
        'slip_no': 1,
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'print_count': 1,
        'gross_amount': 5000,
        'items': [
          {'number': '25', 'units': 10},
          {'number': '52', 'units': 10},
          {'number': '11', 'units': 5},
          {'number': '22', 'units': 5},
          {'number': '45', 'units': 20},
        ],
      };

  static String _lineLabel(({String label, List<String> numbers, int units, List<Map> items}) l) =>
      l.numbers.length > 1 ? '${patternLabel(l.label)} (${l.numbers.length})' : l.label;

  static Future<img.Image> renderTicket(PrinterSettings s, Map ticket, String Function(num) money) async {
    final wide = s.paperMm == 80;
    final t = _Ticket(
      wide ? 576 : 384,
      padLeft: s.padLeft.toDouble().clamp(0, 80),
      padRight: s.padRight.toDouble().clamp(0, 80),
      textAlign: s.posAlign,
    );
    t.text(Company.slipHeader(s.header), size: wide ? 40 : 34, bold: true, gap: 6);
    t.text('${ticket['term_description'] ?? ''}', size: 24, bold: true, gap: 4);
    t.text('Slip: S${ticket['term_id']}-${ticket['slip_no']}', size: 22, gap: 2);
    t.text(dateTime(ticket['created_at']), size: 22, gap: 6);
    if (asInt(ticket['print_count']) > 1) t.text('Copy (${ticket['print_count']})', size: 20, gap: 6);
    t.hr();
    final lines = slipLines(ticket);
    if (s.twoColumn) {
      final size = wide ? 26.0 : 22.0;
      for (var i = 0; i < lines.length; i += 2) {
        final a = lines[i];
        final b = i + 1 < lines.length ? lines[i + 1] : null;
        t.itemSlots([
          (label: _lineLabel(a), unit: '${a.units}'),
          if (b != null) (label: _lineLabel(b), unit: '${b.units}'),
        ], size: size);
      }
    } else {
      for (final l in lines) {
        t.text('${_lineLabel(l)} - ${l.units}', size: 28, bold: true, gap: 4);
      }
    }
    t.hr();
    t.pair('Total:', money(asInt(ticket['gross_amount'])), size: 28, bold: true);
    final foot = s.footer.trim();
    if (foot.isNotEmpty) t.text(foot, size: 22, gap: 8);
    return t.finish();
  }

  static Future<Uint8List> previewPng([PrinterSettings? settings]) async {
    final s = settings ?? await PrinterSettings.load();
    final image = await renderTicket(s, sampleTicket(), defaultMoney);
    return Uint8List.fromList(img.encodePng(image));
  }

  static Future<void> testPrint() async {
    final s = await _ready();
    await _send(s, await renderTicket(s, sampleTicket(), defaultMoney));
  }

  // A saved slip (GET/POST /tickets result), grouped as typed ("45R" is one line).
  static Future<void> printTicket(Map ticket, {required String username, required String Function(num) money}) async {
    final s = await _ready();
    await _send(s, await renderTicket(s, ticket, money));
  }

  // Counts the copy on the server (Slip Copy / "Copy (n)"), then prints.
  static Future<void> printSaved(Map ticket, {required String username, required String Function(num) money}) async {
    await _ready(); // fail early (no printer) before counting a copy
    final counted = await Api.instance.post('/tickets/${ticket['id']}/print') as Map;
    await printTicket({...ticket, 'print_count': counted['print_count']}, username: username, money: money);
  }
}
