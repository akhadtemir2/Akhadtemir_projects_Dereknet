import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Слух Чарльза (JARVIS) — распознавание речи через микрофон.
///
/// Тонкая обёртка над [SpeechToText]: инициализирует движок один раз,
/// слушает одну реплику пользователя и возвращает распознанный текст,
/// автоматически останавливаясь после паузы (тишины). UI подписывается на
/// [listening] и [partial], чтобы показывать статус и «живой» текст.
class JarvisListen {
  JarvisListen._();

  static final SpeechToText _stt = SpeechToText();
  static bool _initialized = false;
  static bool _available = false;

  /// true пока микрофон активно слушает — для орб-анимации/статуса.
  static final listening = ValueNotifier<bool>(false);

  /// Частичный (ещё не финальный) распознанный текст — «живая» подпись.
  static final partial = ValueNotifier<String>('');

  /// Предпочтительные локали распознавания. Команды у нас в основном на
  /// русском; казахский пробуем первым, если браузер/ОС его поддерживает.
  static const _preferredLocales = ['kk_KZ', 'ru_RU', 'ru-RU', 'kk-KZ'];
  static String? _localeId;

  static Future<bool> ensureInitialized() async {
    if (_initialized) return _available;
    _initialized = true;
    try {
      _available = await _stt.initialize(
        onStatus: _onStatus,
        onError: (e) => debugPrint('JarvisListen error: ${e.errorMsg}'),
      );
      if (_available) {
        _localeId = await _pickLocale();
      }
    } catch (e) {
      debugPrint('JarvisListen init failed: $e');
      _available = false;
    }
    return _available;
  }

  static Future<String?> _pickLocale() async {
    try {
      final locales = await _stt.locales();
      for (final want in _preferredLocales) {
        for (final l in locales) {
          if (l.localeId.toLowerCase() == want.toLowerCase()) {
            return l.localeId;
          }
        }
      }
      // Иначе — любой русский, что найдётся.
      for (final l in locales) {
        if (l.localeId.toLowerCase().startsWith('ru')) return l.localeId;
      }
    } catch (_) {}
    return null; // движок возьмёт локаль по умолчанию
  }

  static bool get isAvailable => _available;

  /// Слушает одну реплику. Завершается сам после паузы [pauseFor] или по
  /// достижении [listenFor]. Возвращает распознанный текст (может быть пустым).
  static Future<String> listenOnce({
    Duration listenFor = const Duration(seconds: 20),
    Duration pauseFor = const Duration(seconds: 3),
  }) async {
    if (!await ensureInitialized()) return '';
    if (_stt.isListening) await _stt.stop();

    final completer = Completer<String>();
    var lastWords = '';
    partial.value = '';

    void finish() {
      if (!completer.isCompleted) completer.complete(lastWords.trim());
    }

    try {
      listening.value = true;
      await _stt.listen(
        onResult: (result) {
          lastWords = result.recognizedWords;
          partial.value = lastWords;
          if (result.finalResult) finish();
        },
        listenOptions: SpeechListenOptions(
          localeId: _localeId,
          listenFor: listenFor,
          pauseFor: pauseFor,
          partialResults: true,
          cancelOnError: true,
          listenMode: ListenMode.dictation,
        ),
      );
    } catch (e) {
      debugPrint('JarvisListen listen failed: $e');
      finish();
    }

    // Страховка: если движок не пришлёт finalResult, но перестанет слушать.
    final text = await completer.future;
    listening.value = false;
    partial.value = '';
    return text;
  }

  static void _onStatus(String status) {
    // 'listening' | 'notListening' | 'done'
    if (status == 'done' || status == 'notListening') {
      listening.value = false;
    }
  }

  static Future<void> stop() async {
    try {
      await _stt.stop();
    } catch (_) {}
    listening.value = false;
    partial.value = '';
  }

  static Future<void> cancel() async {
    try {
      await _stt.cancel();
    } catch (_) {}
    listening.value = false;
    partial.value = '';
  }
}
