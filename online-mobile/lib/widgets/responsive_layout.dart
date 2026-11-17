import 'package:flutter/material.dart';

// Copied from online-admin-mobile/lib/widgets/common.dart (responsive layout) — keep in sync.
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
