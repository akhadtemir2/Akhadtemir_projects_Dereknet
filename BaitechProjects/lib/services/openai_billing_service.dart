import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/secrets.dart';

/// Итог по расходам OpenAI API.
class OpenAiUsage {
  /// Потрачено в текущем месяце, USD.
  final double monthSpend;

  /// Потрачено с указанной даты (для расчёта остатка кредитов), USD.
  final double spendSince;

  OpenAiUsage({required this.monthSpend, required this.spendSince});
}

/// Costs API OpenAI. Требует Admin-ключ (sk-admin-…):
/// platform.openai.com → Settings → Organization → Admin keys.
/// Обычный проектный ключ этот endpoint не пускает — так задумано OpenAI.
class OpenAiBillingService {
  static bool get isConfigured => Secrets.openAiAdminKey.isNotEmpty;

  /// Суммирует расходы: за текущий месяц и с даты [since]
  /// (обычно — дата первого пополнения кредитов).
  static Future<OpenAiUsage> fetchUsage({required DateTime since}) async {
    final now = DateTime.now();
    final monthStart = DateTime(now.year, now.month, 1);
    final from = since.isBefore(monthStart) ? since : monthStart;

    double monthSpend = 0;
    double spendSince = 0;

    String? page;
    while (true) {
      final params = <String, String>{
        'start_time': '${from.toUtc().millisecondsSinceEpoch ~/ 1000}',
        'limit': '180',
        if (page != null) 'page': page,
      };
      final uri = Uri.https('api.openai.com', '/v1/organization/costs', params);
      final res = await http.get(uri, headers: {
        'Authorization': 'Bearer ${Secrets.openAiAdminKey}',
      });
      if (res.statusCode == 401 || res.statusCode == 403) {
        throw OpenAiAdminKeyException();
      }
      if (res.statusCode != 200) {
        throw Exception('Costs API ${res.statusCode}: ${res.body}');
      }
      final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      for (final bucket in (j['data'] as List? ?? [])) {
        final start = DateTime.fromMillisecondsSinceEpoch(
            ((bucket['start_time'] as num).toInt()) * 1000);
        for (final r in (bucket['results'] as List? ?? [])) {
          // API возвращает value то числом, то строкой — парсим устойчиво
          final raw = r['amount']?['value'];
          final v = raw is num
              ? raw.toDouble()
              : double.tryParse(raw?.toString() ?? '') ?? 0;
          if (!start.isBefore(since)) spendSince += v;
          if (!start.isBefore(monthStart)) monthSpend += v;
        }
      }
      if (j['has_more'] == true && j['next_page'] != null) {
        page = j['next_page'] as String;
      } else {
        break;
      }
    }
    return OpenAiUsage(monthSpend: monthSpend, spendSince: spendSince);
  }
}

class OpenAiAdminKeyException implements Exception {
  @override
  String toString() =>
      'Для баланса OpenAI нужен Admin-ключ (sk-admin-…) — обычный ключ API не даёт доступ к биллингу';
}
