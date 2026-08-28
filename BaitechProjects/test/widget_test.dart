import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baitech_dashboard/models/models.dart';
import 'package:baitech_dashboard/widgets/common.dart';

void main() {
  group('FocusableTap', () {
    testWidgets('показывает кольцо фокуса и активируется по Enter',
        (tester) async {
      var tapCount = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: FocusableTap(
            autofocus: true,
            onTap: () => tapCount++,
            child: const SizedBox(width: 40, height: 40),
          ),
        ),
      ));
      await tester.pump();

      final decoratedBox = tester.widget<Container>(find.byType(Container));
      final decoration = decoratedBox.decoration as BoxDecoration;
      expect(decoration.border, isNotNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(tapCount, 1);
    });
  });

  test('статусы проекта корректно маппятся из БД', () {
    expect(ProjectStatus.fromDb('todo'), ProjectStatus.todo);
    expect(ProjectStatus.fromDb('in_progress'), ProjectStatus.inProgress);
    expect(ProjectStatus.fromDb('done'), ProjectStatus.done);
    expect(ProjectStatus.fromDb('unknown'), ProjectStatus.todo);
  });

  test('daysLeft считает дни до дедлайна', () {
    final today = DateTime.now();
    Project p(DateTime? d) => Project(
          id: 'x',
          title: 't',
          status: ProjectStatus.todo,
          deadline: d,
          createdAt: today,
          updatedAt: today,
        );
    expect(p(null).daysLeft, isNull);
    expect(p(today).daysLeft, 0);
    expect(p(today.add(const Duration(days: 3))).daysLeft, 3);
    expect(p(today.subtract(const Duration(days: 2))).daysLeft, -2);
  });
}
