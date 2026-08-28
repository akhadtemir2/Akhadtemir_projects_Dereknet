import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Web: record возвращает blob-URL, файл на диск не пишется.
Future<String> recordingPath() async => '';

Future<Uint8List> readRecording(String path) async =>
    (await http.get(Uri.parse(path))).bodyBytes;

String recordingFilename() => 'voice.webm';
