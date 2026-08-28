import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/secrets.dart';

/// Результат разбора голосовой команды в структуру задачи.
class ParsedTask {
  final String title;
  final String? description;
  final String? assigneeName; // Akhad | Ruslan | null
  final DateTime? deadline;

  ParsedTask({
    required this.title,
    this.description,
    this.assigneeName,
    this.deadline,
  });
}

/// OpenAI: Whisper (речь → текст) + GPT (текст → структура задачи).
class AiService {
  static bool get isConfigured => Secrets.openAiApiKey.isNotEmpty;

  /// Распознаёт речь из аудио (webm/m4a/wav) через Whisper.
  static Future<String> transcribe(List<int> audioBytes, String filename) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('https://api.openai.com/v1/audio/transcriptions'),
    )
      ..headers['Authorization'] = 'Bearer ${Secrets.openAiApiKey}'
      ..fields['model'] = 'whisper-1'
      ..fields['language'] = 'ru'
      ..files.add(http.MultipartFile.fromBytes(
        'file',
        audioBytes,
        filename: filename,
      ));
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode != 200) {
      throw Exception('Whisper error ${res.statusCode}: ${res.body}');
    }
    return (jsonDecode(utf8.decode(res.bodyBytes))
        as Map<String, dynamic>)['text'] as String;
  }

  /// Превращает свободный текст («Задание для Ахада — сделать X до пятницы»)
  /// в структурированную задачу.
  static Future<ParsedTask> parseTask(String text) async {
    final today = DateTime.now();
    final res = await http.post(
      Uri.parse('https://api.openai.com/v1/chat/completions'),
      headers: {
        'Authorization': 'Bearer ${Secrets.openAiApiKey}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'model': 'gpt-4o-mini',
        'temperature': 0,
        'response_format': {'type': 'json_object'},
        'messages': [
          {
            'role': 'system',
            'content': 'Ты парсер задач для дашборда компании BaiTech. '
                'Сегодня ${today.toIso8601String().substring(0, 10)}. '
                'Исполнители: Akhad (Ахад), Ruslan (Руслан). '
                'Из текста выдели JSON: {"title": string (краткое название задачи), '
                '"description": string|null (детали, если есть), '
                '"assignee": "Akhad"|"Ruslan"|null, '
                '"deadline": "YYYY-MM-DD"|null (переведи «до пятницы», «завтра» и т.п. в дату)}. '
                'Отвечай только JSON.',
          },
          {'role': 'user', 'content': text},
        ],
      }),
    );
    if (res.statusCode != 200) {
      throw Exception('OpenAI error ${res.statusCode}: ${res.body}');
    }
    final content = (jsonDecode(utf8.decode(res.bodyBytes))['choices'][0]
        ['message']['content']) as String;
    final j = jsonDecode(content) as Map<String, dynamic>;
    return ParsedTask(
      title: (j['title'] as String?)?.trim().isNotEmpty == true
          ? (j['title'] as String).trim()
          : text,
      description: j['description'] as String?,
      assigneeName: j['assignee'] as String?,
      deadline: j['deadline'] == null
          ? null
          : DateTime.tryParse(j['deadline'] as String),
    );
  }
}
