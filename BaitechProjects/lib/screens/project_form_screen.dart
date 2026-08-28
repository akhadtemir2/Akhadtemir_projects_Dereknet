import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../models/models.dart';
import '../services/ai_service.dart';
import '../services/audio_bytes/audio_bytes.dart' as audio;
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

/// Создание/редактирование проекта. С голосовым вводом через Whisper:
/// «Задание для Ахада — сделать интеграцию базы до пятницы».
class ProjectFormScreen extends StatefulWidget {
  final Project? existing;
  const ProjectFormScreen({super.key, this.existing});

  @override
  State<ProjectFormScreen> createState() => _ProjectFormScreenState();
}

class _ProjectFormScreenState extends State<ProjectFormScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _githubCtrl = TextEditingController();
  String? _assigneeId;
  DateTime? _deadline;
  bool _saving = false;

  // голос
  final _recorder = AudioRecorder();
  bool _recording = false;
  bool _transcribing = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final p = widget.existing;
    if (p != null) {
      _titleCtrl.text = p.title;
      _descCtrl.text = p.description ?? '';
      _githubCtrl.text = p.githubUrl ?? '';
      _assigneeId = p.assigneeId;
      _deadline = p.deadline;
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _githubCtrl.dispose();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _toggleRecord() async {
    if (!AiService.isConfigured) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Голосовой ввод не настроен: приложение собрано без OPENAI_API_KEY'),
      ));
      return;
    }
    final state = context.read<AppState>();
    if (_recording) {
      final path = await _recorder.stop();
      setState(() {
        _recording = false;
        _transcribing = true;
      });
      try {
        // на вебе stop() возвращает blob-URL, на мобильных — путь к файлу
        final Uint8List bytes = await audio.readRecording(path!);
        final filename = audio.recordingFilename();
        final text = await AiService.transcribe(bytes, filename);
        final parsed = await AiService.parseTask(text);
        setState(() {
          _titleCtrl.text = parsed.title;
          if ((parsed.description ?? '').isNotEmpty) {
            _descCtrl.text = parsed.description!;
          }
          if (parsed.assigneeName != null) {
            final dev = state.developers
                .where((d) =>
                    d.name.toLowerCase() == parsed.assigneeName!.toLowerCase())
                .firstOrNull;
            if (dev != null) _assigneeId = dev.id;
          }
          if (parsed.deadline != null) _deadline = parsed.deadline;
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Распознано: «$text»')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Ошибка распознавания: $e')),
          );
        }
      } finally {
        if (mounted) setState(() => _transcribing = false);
      }
    } else {
      if (await _recorder.hasPermission()) {
        await _recorder.start(
          const RecordConfig(encoder: AudioEncoder.aacLc),
          path: kIsWeb ? '' : await audio.recordingPath(),
        );
        setState(() => _recording = true);
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Нет доступа к микрофону')));
        }
      }
    }
  }

  Future<void> _pickDeadline() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _deadline ?? now.add(const Duration(days: 7)),
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now.add(const Duration(days: 365 * 3)),
      locale: const Locale('ru'),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.dark(
            primary: AppColors.cyan,
            surface: AppColors.surface,
          ),
        ),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _deadline = picked);
  }

  Future<void> _save() async {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Введи название проекта')));
      return;
    }
    setState(() => _saving = true);
    final state = context.read<AppState>();
    try {
      if (_isEdit) {
        final p = widget.existing!;
        await state.updateProject(
          p,
          {
            'title': title,
            'description':
                _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
            'assignee_id': _assigneeId,
            'deadline': _deadline?.toUtc().toIso8601String(),
            'github_url': _githubCtrl.text.trim().isEmpty
                ? null
                : _githubCtrl.text.trim(),
          },
          activity: 'отредактировал(а) проект',
        );
      } else {
        await state.createProject(
          title: title,
          description:
              _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
          assigneeId: _assigneeId,
          deadline: _deadline,
          githubUrl:
              _githubCtrl.text.trim().isEmpty ? null : _githubCtrl.text.trim(),
        );
      }
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Ошибка сохранения: $e')));
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'РЕДАКТИРОВАТЬ' : 'НОВЫЙ ПРОЕКТ'),
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
          child: GradientIconButton(
            icon: Icons.arrow_back_ios_new_rounded,
            size: 42,
            onTap: () => Navigator.pop(context),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          if (!_isEdit) _voiceCard(),
          const SizedBox(height: 16),
          const _Label('Название'),
          TextField(
            controller: _titleCtrl,
            decoration:
                const InputDecoration(hintText: 'Например: Сайт для клиента X'),
          ),
          const SizedBox(height: 16),
          const _Label('Описание / ТЗ'),
          TextField(
            controller: _descCtrl,
            maxLines: 5,
            decoration: const InputDecoration(
                hintText: 'Что нужно сделать, детали, ссылки…'),
          ),
          const SizedBox(height: 16),
          const _Label('Исполнитель'),
          Row(
            children: [
              _assigneeChip(null, 'Не назначен'),
              ...state.developers.map((d) => _assigneeChip(d, d.name)),
            ],
          ),
          const SizedBox(height: 16),
          const _Label('Дедлайн'),
          DarkCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            onTap: _pickDeadline,
            child: Row(
              children: [
                const Icon(Icons.event_rounded, color: AppColors.cyan),
                const SizedBox(width: 12),
                Text(
                  _deadline == null
                      ? 'Выбрать дату'
                      : DateFormat('d MMMM yyyy', 'ru').format(_deadline!),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                if (_deadline != null)
                  FocusableTap(
                    onTap: () => setState(() => _deadline = null),
                    child: const Icon(Icons.close_rounded,
                        size: 18, color: AppColors.textSecondary),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const _Label('Ссылка на GitHub (необязательно)'),
          TextField(
            controller: _githubCtrl,
            decoration: const InputDecoration(
                hintText: 'https://github.com/akhadtemir2/…'),
          ),
          const SizedBox(height: 28),
          GradientButton(
            label: _saving
                ? 'Сохраняю…'
                : (_isEdit ? 'Сохранить' : 'Создать проект'),
            icon: Icons.check_rounded,
            onTap: _saving ? null : _save,
          ),
        ],
      ),
    );
  }

  Widget _voiceCard() {
    return DarkCard(
      child: Row(
        children: [
          FocusableTap(
            borderRadius: BorderRadius.circular(28),
            onTap: _transcribing ? null : _toggleRecord,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                gradient: _recording ? null : AppColors.accentGradient,
                color: _recording ? AppColors.red : null,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: (_recording ? AppColors.red : AppColors.indigo)
                        .withValues(alpha: 0.5),
                    blurRadius: 16,
                  ),
                ],
              ),
              child: Icon(
                _transcribing
                    ? Icons.hourglass_top_rounded
                    : (_recording ? Icons.stop_rounded : Icons.mic_rounded),
                color: Colors.white,
                size: 26,
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              _transcribing
                  ? 'Распознаю через ИИ…'
                  : _recording
                      ? 'Говори… Нажми стоп, когда закончишь.'
                      : 'Голосом: «Задание для Ахада — сделать X до пятницы». ИИ сам заполнит форму.',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 13, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  Widget _assigneeChip(Member? m, String label) {
    final active = _assigneeId == m?.id;
    final color = m?.avatarColor ?? AppColors.textSecondary;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FocusableTap(
        onTap: () => setState(() => _assigneeId = m?.id),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: active ? color.withValues(alpha: 0.18) : AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: active ? color : Colors.transparent),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: active ? color : AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
