import 'dart:convert';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/secrets.dart';

/// Голос Чарльза (JARVIS) — OpenAI TTS-HD + воспроизведение.
///
/// Использует `tts-1-hd` и голос `onyx` — глубокий мужской. Экспортирует
/// [speaking] ValueNotifier, который UI использует для waveform-анимации:
/// true = аудио воспроизводится, false = остановлено.
class JarvisVoice {
  JarvisVoice._();

  static final AudioPlayer _player = AudioPlayer();
  static const _endpoint = 'https://api.openai.com/v1/audio/speech';
  static const _model = 'tts-1-hd';
  static const _voice = 'onyx';

  /// Сигнал для орб-анимации: true пока JARVIS говорит.
  static final speaking = ValueNotifier<bool>(false);

  static bool get isConfigured => Secrets.openAiApiKey.isNotEmpty;

  /// Проговаривает текст. Не ждёт окончания воспроизведения —
  /// см. [speakAndWait], если нужно дождаться тишины (для голосового диалога).
  static Future<void> speak(String text) => _play(text, awaitEnd: false);

  /// Проговаривает текст и завершается, только когда аудио доиграло до конца
  /// (или упало с ошибкой). Нужно диалоговому циклу, чтобы включить микрофон
  /// уже после того, как JARVIS замолчал — иначе он услышит сам себя.
  static Future<void> speakAndWait(String text) => _play(text, awaitEnd: true);

  static Future<void> _play(String text, {required bool awaitEnd}) async {
    final trimmed = text.trim();
    if (!isConfigured || trimmed.isEmpty) return;

    try {
      final res = await http.post(
        Uri.parse(_endpoint),
        headers: {
          'Authorization': 'Bearer ${Secrets.openAiApiKey}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'model': _model,
          'voice': _voice,
          'input': trimmed,
          'response_format': 'mp3',
          'speed': 1.0,
        }),
      );
      if (res.statusCode != 200) return;

      await _player.stop();
      speaking.value = true;
      final done = _player.onPlayerComplete.first;
      await _player.play(BytesSource(res.bodyBytes));
      if (awaitEnd) {
        await done;
        speaking.value = false;
      } else {
        done.then((_) => speaking.value = false).ignore();
      }
    } catch (_) {
      speaking.value = false;
    }
  }

  static Future<void> stop() async {
    try {
      await _player.stop();
      speaking.value = false;
    } catch (_) {}
  }
}
