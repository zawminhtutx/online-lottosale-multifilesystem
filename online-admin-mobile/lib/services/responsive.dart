// Shared sizing helpers so grids/keys stay a similar physical size on both a small phone and a
// large phone/tablet, instead of a fixed column count or fixed size looking cramped on one and
// tiny/wasted on the other.
class Responsive {
  // Grid column count that keeps each cell close to [idealCellWidth] logical pixels wide,
  // clamped to [minCount]/[maxCount] so it never gets absurdly sparse (huge cells on a tablet) or
  // dense (squeezed text overflowing its cell on a narrow phone).
  static int columnsForWidth(double width, {required double idealCellWidth, int minCount = 2, int maxCount = 12}) {
    final count = (width / idealCellWidth).round();
    return count.clamp(minCount, maxCount);
  }

  // Scales a base size (e.g. a keypad key's height) up on wider screens relative to a reference
  // phone width, capped at [maxScale] so it doesn't keep growing without bound on very large
  // screens/tablets — never shrinks below the base size on a narrower-than-reference phone.
  static double scale(double width, double base, {double referenceWidth = 400, double maxScale = 1.5}) {
    final factor = (width / referenceWidth).clamp(1.0, maxScale);
    return base * factor;
  }
}
