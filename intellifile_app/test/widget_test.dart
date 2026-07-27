import 'package:flutter_test/flutter_test.dart';
import 'package:intellifile_app/main.dart';

void main() {
  testWidgets('App renders without errors', (WidgetTester tester) async {
    await tester.pumpWidget(const IntelliFileApp());
    // The splash screen should appear first
    expect(find.text('IntelliFile'), findsOneWidget);
  });
}
