import 'package:flutter/material.dart';
import 'package:flutter/services.dart';


// The term's hot numbers scrolling across the Sale screen: "🔥 ဟော့ဂဏန်းများ: 12, 45, 78".
// Nothing shows when the term has no hot numbers.
class HotMarquee extends StatefulWidget {
  final Map<String, dynamic> term;
  const HotMarquee({super.key, required this.term});

  @override
  State<HotMarquee> createState() => _HotMarqueeState();
}

class _HotMarqueeState extends State<HotMarquee> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(vsync: this);
  static const _style = TextStyle(color: Color(0xFFC2410C), fontWeight: FontWeight.w700, fontSize: 13.5);

  String get _text {
    final hot = (widget.term['hot'] as List? ?? const []).cast<Map>();
    final numbers = hot.map((h) => '${h['number']}').toSet().toList()..sort();
    return numbers.join(', '); // each number once, comma-separated (the label stays fixed)
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if ((widget.term['hot'] as List? ?? const []).isEmpty) return const SizedBox.shrink();
    final text = _text;
    return Container(
      height: 32,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: const Color(0xFFFDBA74)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(9),
        child: Row(children: [
          // Fixed label at the left; only the numbers scroll.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: Color(0xFFFFEDD5),
              border: Border(right: BorderSide(color: Color(0xFFFDBA74))),
            ),
            child: const Text('🔥 ဟော့ဂဏန်းများ:', style: _style),
          ),
          Expanded(
            child: LayoutBuilder(builder: (ctx, box) {
              final painter = TextPainter(text: TextSpan(text: text, style: _style), textDirection: TextDirection.ltr, maxLines: 1)
                ..layout();
              final distance = box.maxWidth + painter.width; // enters from the right, leaves on the left
              final duration = Duration(milliseconds: (distance / 60 * 1000).round()); // ~60 px per second
              if (_ctrl.duration != duration) {
                _ctrl.duration = duration;
                _ctrl.repeat();
              }
              return AnimatedBuilder(
                animation: _ctrl,
                builder: (ctx, _) => Stack(clipBehavior: Clip.hardEdge, children: [
                  Positioned(
                    left: box.maxWidth - _ctrl.value * distance,
                    top: 0,
                    bottom: 0,
                    child: Center(child: Text(text, style: _style, maxLines: 1, softWrap: false)),
                  ),
                ]),
              );
            }),
          ),
          // 🔥 fixed at the right end: the hot numbers in a dialog.
          Material(
            color: const Color(0xFFFFEDD5),
            child: InkWell(
              onTap: () => _showNumbers(context),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                alignment: Alignment.center,
                decoration: const BoxDecoration(border: Border(left: BorderSide(color: Color(0xFFFDBA74)))),
                child: const Text('🔥', style: TextStyle(fontSize: 16)),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  void _showNumbers(BuildContext context) {
    final numbers = (widget.term['hot'] as List? ?? const []).cast<Map>().map((h) => '${h['number']}').toSet().toList()..sort();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('🔥 ဟော့ဂဏန်းများ'),
        // Shown like a plain text box: one number per line.
        content: SizedBox(
          width: double.maxFinite,
          child: TextField(
            controller: TextEditingController(text: numbers.join('\n')),
            readOnly: true,
            minLines: 3,
            maxLines: 12,
            style: const TextStyle(fontSize: 16, height: 1.5),
            decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton.icon(
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('Copy'),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: numbers.join('\n'))); // one number per line
              if (!ctx.mounted) return;
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('ဟော့ဂဏန်း ${numbers.length} လုံး copy ကူးပြီးပါပြီ'), backgroundColor: Colors.teal),
              );
            },
          ),
        ],
      ),
    );
  }
}
