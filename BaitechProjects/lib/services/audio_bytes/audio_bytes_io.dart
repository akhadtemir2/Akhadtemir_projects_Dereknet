import 'dart:io';
import 'dart:typed_data';

/// Мобильные/десктоп: запись пишется во временный файл.
Future<String> recordingPath() async =>
    '${Directory.systemTemp.path}/bt_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';

Future<Uint8List> readRecording(String path) => File(path).readAsBytes();

String recordingFilename() => 'voice.m4a';
