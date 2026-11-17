// One row in the Sale page's cart — mirrors the desktop SalePage's own cart shape
// ({key, numbers, grouptype, unit, discount}) so the same fields go straight into
// POST /sales' items (see server/src/routes/sales.routes.js, which already accepts
// per-item `key`/`grouptype` for pattern/group bets).
class PatternEntry {
  final String key; // raw typed pattern, e.g. "45R", "1P", "12"
  final List<String> numbers; // expanded individual bet numbers
  final int? grouptype;
  double unit;
  double discount;
  String note;

  PatternEntry({
    required this.key,
    required this.numbers,
    this.grouptype,
    required this.unit,
    this.discount = 0,
    this.note = '',
  });

  // What the Sale table's ပမာဏ column shows — the per-number amount, same value as the
  // ယူနစ် field (this business's "unit" already IS the Kyat amount per number, not a
  // multiplier — see sales.routes.js: payment = unit * (1 - discount/100), no unitprice).
  double get amount => unit;

  // What actually gets charged across every number this pattern expands to.
  double get totalAfterDiscount => unit * (1 - discount / 100) * numbers.length;
}
