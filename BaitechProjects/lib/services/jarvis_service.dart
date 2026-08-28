import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/secrets.dart';

/// Одно сообщение диалога с JARVIS.
class JarvisMessage {
  final String role; // 'user' | 'assistant'
  final String content;
  const JarvisMessage(this.role, this.content);
}

/// Исполнитель инструмента: принимает имя инструмента и его аргументы,
/// выполняет действие над проектами и возвращает короткий текстовый результат,
/// который уходит обратно модели. Живёт на стороне экрана (у него есть доступ
/// к состоянию приложения), поэтому сам сервис ничего не знает про Flutter.
typedef ToolExecutor = Future<String> Function(
    String name, Map<String, dynamic> args);

/// JARVIS («Чарльз») — ассистент управления проектами BaiTech поверх
/// OpenAI gpt-4o-mini с function-calling. Тот же ключ, что и у остального ИИ
/// в приложении ([Secrets.openAiApiKey]).
class JarvisService {
  static bool get isConfigured => Secrets.openAiApiKey.isNotEmpty;

  static const _endpoint = 'https://api.openai.com/v1/chat/completions';
  static const _model = 'gpt-4o-mini';
  static const _maxToolRounds = 6;

  /// Схема инструментов в формате OpenAI. Каждый инструмент соответствует
  /// реальному действию над проектами (см. исполнитель в jarvis_screen.dart).
  static List<Map<String, dynamic>> _tools() => [
        {
          'type': 'function',
          'function': {
            'name': 'list_projects',
            'description':
                'Показать список проектов с их статусом, исполнителем и '
                    'дедлайном. Можно отфильтровать по статусу и/или исполнителю.',
            'parameters': {
              'type': 'object',
              'properties': {
                'status': {
                  'type': 'string',
                  'enum': ['all', 'todo', 'in_progress', 'done'],
                  'description': 'Фильтр по статусу (по умолчанию all).',
                },
                'assignee': {
                  'type': 'string',
                  'description': 'Имя исполнителя, напр. «Ахад» или «Руслан».',
                },
              },
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'create_project',
            'description': 'Создать новый проект/задачу.',
            'parameters': {
              'type': 'object',
              'properties': {
                'title': {
                  'type': 'string',
                  'description': 'Короткое название проекта.',
                },
                'description': {
                  'type': 'string',
                  'description': 'Детали задачи, если есть.',
                },
                'assignee': {
                  'type': 'string',
                  'description': 'Имя исполнителя (Ахад / Руслан). Необязательно.',
                },
                'deadline': {
                  'type': 'string',
                  'description': 'Дедлайн в формате YYYY-MM-DD. Необязательно.',
                },
              },
              'required': ['title'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'update_project',
            'description':
                'Изменить существующий проект: статус, исполнитель и/или '
                    'дедлайн. Проект ищется по названию.',
            'parameters': {
              'type': 'object',
              'properties': {
                'query': {
                  'type': 'string',
                  'description': 'Название проекта (можно часть).',
                },
                'status': {
                  'type': 'string',
                  'enum': ['todo', 'in_progress', 'done'],
                  'description': 'Новый статус.',
                },
                'assignee': {
                  'type': 'string',
                  'description': 'Новый исполнитель (Ахад / Руслан).',
                },
                'deadline': {
                  'type': 'string',
                  'description':
                      'Новый дедлайн YYYY-MM-DD, либо «none» чтобы убрать.',
                },
              },
              'required': ['query'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'delete_project',
            'description': 'Удалить проект по названию. Действие необратимо.',
            'parameters': {
              'type': 'object',
              'properties': {
                'query': {
                  'type': 'string',
                  'description': 'Название проекта (можно часть).',
                },
              },
              'required': ['query'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'team_overview',
            'description':
                'Сводка по команде: кто есть и сколько у каждого открытых и '
                    'закрытых проектов (нагрузка).',
            'parameters': {'type': 'object', 'properties': {}},
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'expenses_summary',
            'description':
                'Итоги расходов компании за период (месяц / 3 месяца / год).',
            'parameters': {
              'type': 'object',
              'properties': {
                'months': {
                  'type': 'integer',
                  'enum': [1, 3, 12],
                  'description': 'Период в месяцах (по умолчанию 1).',
                },
              },
            },
          },
        },
      ];

  /// Прогоняет один ход диалога: отправляет системный промпт + историю +
  /// инструменты, выполняет затребованные вызовы через [exec] и возвращает
  /// финальный текст ответа ассистента.
  static Future<String> ask({
    required String systemPrompt,
    required List<JarvisMessage> history,
    required ToolExecutor exec,
  }) async {
    final messages = <Map<String, dynamic>>[
      {'role': 'system', 'content': systemPrompt},
      for (final m in history) {'role': m.role, 'content': m.content},
    ];

    for (var round = 0; round < _maxToolRounds; round++) {
      final res = await http.post(
        Uri.parse(_endpoint),
        headers: {
          'Authorization': 'Bearer ${Secrets.openAiApiKey}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'model': _model,
          'temperature': 0.2,
          'messages': messages,
          'tools': _tools(),
        }),
      );

      if (res.statusCode != 200) {
        throw Exception('OpenAI ${res.statusCode}: ${res.body}');
      }

      final body =
          jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      final choice = (body['choices'] as List).first as Map<String, dynamic>;
      final msg = choice['message'] as Map<String, dynamic>;
      final toolCalls = msg['tool_calls'] as List?;

      if (toolCalls == null || toolCalls.isEmpty) {
        return (msg['content'] as String?)?.trim() ?? '';
      }

      // Ответ модели с запросом инструментов нужно вернуть в историю дословно.
      messages.add({
        'role': 'assistant',
        'content': msg['content'],
        'tool_calls': toolCalls,
      });

      for (final tc in toolCalls) {
        final call = tc as Map<String, dynamic>;
        final fn = call['function'] as Map<String, dynamic>;
        final name = fn['name'] as String;

        var args = <String, dynamic>{};
        final raw = fn['arguments'];
        if (raw is String && raw.trim().isNotEmpty) {
          try {
            final parsed = jsonDecode(raw);
            if (parsed is Map<String, dynamic>) args = parsed;
          } catch (_) {/* оставляем пустые аргументы */}
        }

        String result;
        try {
          result = await exec(name, args);
        } catch (e) {
          result = 'Ошибка выполнения: $e';
        }

        messages.add({
          'role': 'tool',
          'tool_call_id': call['id'],
          'content': result,
        });
      }
    }

    return 'Не удалось завершить действие за отведённое число шагов. '
        'Попробуй переформулировать запрос.';
  }
}
