import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:online_lotto_mobile/widgets/folder_term_filter.dart';

void main() {
  // The user bet only in "AM"; the folder also holds "PM", which must still be listed.
  final slips = [
    {'id': 1, 'term_id': 10, 'term_description': '07-11 AM', 'folder_id': 3, 'folder_name': '07-11-2026'},
  ];
  final terms = [
    {'id': 10, 'description': '07-11 AM', 'folder_id': 3, 'folder_name': '07-11-2026'},
    {'id': 11, 'description': '07-11 PM', 'folder_id': 3, 'folder_name': '07-11-2026'},
    {'id': 12, 'description': '08-11 AM', 'folder_id': 4, 'folder_name': '08-11-2026'},
  ];

  Future<void> pump(WidgetTester tester, {int? folderId}) => tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: FolderTermFilter(rows: slips, allTerms: terms, termNameKey: 'term_description', folderId: folderId, termId: null, onChanged: (_, _) {}),
        ),
      ));

  testWidgets('a picked folder lists all its terms, with or without slips', (tester) async {
    await pump(tester, folderId: 3);
    await tester.tap(find.text('အပါတ်စဥ် အားလုံး'));
    await tester.pumpAndSettle();
    expect(find.text('07-11 AM'), findsWidgets);
    expect(find.text('07-11 PM'), findsWidgets); // no slips in it, still listed
    expect(find.text('08-11 AM'), findsNothing); // another folder
  });

  testWidgets('folders without slips are listed too', (tester) async {
    await pump(tester);
    await tester.tap(find.text('ဖိုင် အားလုံး'));
    await tester.pumpAndSettle();
    expect(find.text('08-11-2026'), findsWidgets);
  });

  test('a term without slips matches no slip', () {
    expect(slips.where((s) => FolderTermFilter.matches(s, 3, 11)), isEmpty);
    expect(slips.where((s) => FolderTermFilter.matches(s, 3, 10)).length, 1);
  });
}
