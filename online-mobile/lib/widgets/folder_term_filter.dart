import 'package:flutter/material.dart';

import '../services/api.dart';
import 'dash_style.dart';

// ဖိုင် → အပါတ်စဥ် select boxes (slips and report screens). The folders and terms come from the
// rows shown (each has folder_id / folder_name / term_id and a term name under [termNameKey]) and,
// when given, from [allTerms] (GET /terms rows: id, description, folder_id, folder_name) — so a
// picked folder lists every one of its terms, also those the user has no slips in (picking one of
// those then shows nothing). The term box stays off until a folder is picked.
// folder 0 = terms without a folder.
class FolderTermFilter extends StatelessWidget {
  final List<Map<String, dynamic>> rows;
  final List<Map<String, dynamic>> allTerms;
  final String termNameKey;
  final int? folderId;
  final int? termId;
  final void Function(int? folderId, int? termId) onChanged;
  const FolderTermFilter({
    super.key,
    required this.rows,
    this.allTerms = const [],
    required this.termNameKey,
    required this.folderId,
    required this.termId,
    required this.onChanged,
  });

  // Whether [row] passes the picked folder / term.
  static bool matches(Map<String, dynamic> row, int? folderId, int? termId) =>
      (folderId == null || asInt(row['folder_id']) == folderId) && (termId == null || asInt(row['term_id']) == termId);

  @override
  Widget build(BuildContext context) {
    final folders = <int, String>{};
    final terms = <int, String>{};
    // The slips first (they always carry the folder's name), then every other term.
    for (final r in rows) {
      final f = asInt(r['folder_id']);
      folders.putIfAbsent(f, () => r['folder_name'] == null ? 'ဖိုင်မရှိ' : '${r['folder_name']}');
      if (folderId != null && f == folderId) terms.putIfAbsent(asInt(r['term_id']), () => '${r[termNameKey]}');
    }
    for (final t in allTerms) {
      final f = asInt(t['folder_id']);
      folders.putIfAbsent(f, () => t['folder_name'] == null ? (f == 0 ? 'ဖိုင်မရှိ' : 'ဖိုင် #$f') : '${t['folder_name']}');
      if (folderId != null && f == folderId) terms.putIfAbsent(asInt(t['id']), () => '${t['description']}');
    }
    final pickedFolder = folders.containsKey(folderId) ? folderId : null;
    final pickedTerm = terms.containsKey(termId) ? termId : null;
    DropdownButtonFormField<int?> box(String label, int? value, List<DropdownMenuItem<int?>> items, ValueChanged<int?>? onPick) =>
        DropdownButtonFormField<int?>(
          key: ValueKey('$label-$value-${items.length}'),
          initialValue: value,
          isExpanded: true,
          dropdownColor: Dash.bottom,
          iconEnabledColor: Colors.white,
          iconDisabledColor: Colors.white38,
          style: const TextStyle(color: Colors.white, fontSize: 15),
          decoration: dashInput(label),
          items: items,
          onChanged: onPick,
        );
    return Row(children: [
      Expanded(
        child: box('ဖိုင်', pickedFolder, [
          const DropdownMenuItem(value: null, child: Text('ဖိုင် အားလုံး')),
          for (final e in folders.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
        ], (v) => onChanged(v, null)),
      ),
      const SizedBox(width: 8),
      Expanded(
        // Off until a folder is picked: then only that folder's terms.
        child: box(
          'အပါတ်စဥ်',
          pickedTerm,
          [
            DropdownMenuItem(value: null, child: Text(pickedFolder == null ? 'ဖိုင် အရင်ရွေးပါ' : 'အပါတ်စဥ် အားလုံး')),
            for (final e in terms.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis)),
          ],
          pickedFolder == null ? null : (v) => onChanged(pickedFolder, v),
        ),
      ),
    ]);
  }
}
