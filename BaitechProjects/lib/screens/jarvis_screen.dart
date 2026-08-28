import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/jarvis_service.dart';
import '../services/jarvis_voice.dart';
import '../services/jarvis_listen.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';

/// Фазы голосового диалога с JARVIS.
enum _Phase { greeting, idle, listening, thinking, speaking, error, disabled }

enum _OrbState { idle, listening, thinking, speaking }

/// Полноэкранный голосовой JARVIS.
///
/// Никакого текстового чата и примеров: нажал на центральную кнопку — открылся
/// экран, JARVIS поздоровался по-казахски и слушает. Дальше — живой диалог
/// голосом: человек говорит («задай проект Руслану до пятницы…»), JARVIS
/// уточняет, если непонятно, и создаёт/назначает проект. Мозг тот же
/// ([JarvisService] с function-calling), меняется только способ общения.
class JarvisScreen extends StatefulWidget {
  const JarvisScreen({super.key});

  @override
  State<JarvisScreen> createState() => _JarvisScreenState();
}

class _JarvisScreenState extends State<JarvisScreen> {
  final List<JarvisMessage> _history = [];

  _Phase _phase = _Phase.greeting;
  String _heard = ''; // последняя реплика пользователя
  String _reply = ''; // последний ответ JARVIS (подпись под орбом)
  bool _closing = false;

  static const _kazakhGreeting = 'Сәлеметсіз бе! Мен JARVIS. '
      'Сізге қалай көмектесе аламын?';

  @override
  void initState() {
    super.initState();
    JarvisListen.partial.addListener(_onPartial);
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  @override
  void dispose() {
    _closing = true;
    JarvisListen.partial.removeListener(_onPartial);
    JarvisListen.cancel();
    JarvisVoice.stop();
    super.dispose();
  }

  void _onPartial() {
    if (!mounted || _phase != _Phase.listening) return;
    setState(() => _heard = JarvisListen.partial.value);
  }

  // ── Диалоговый цикл ────────────────────────────────────────────────────────

  Future<void> _boot() async {
    if (!JarvisService.isConfigured) {
      setState(() {
        _phase = _Phase.disabled;
        _reply = 'JARVIS выключен: соберите приложение с '
            '--dart-define=OPENAI_API_KEY=…';
      });
      return;
    }

    // Приветствие голосом на казахском, затем — сразу слушаем.
    setState(() {
      _phase = _Phase.speaking;
      _reply = _kazakhGreeting;
    });
    final state = context.read<AppState>();
    if (state.voiceEnabled) {
      await JarvisVoice.speakAndWait(_kazakhGreeting);
    }
    if (_closing || !mounted) return;
    _listen();
  }

  Future<void> _listen() async {
    if (_closing || !mounted) return;

    final available = await JarvisListen.ensureInitialized();
    if (!available) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.error;
        _reply = 'Микрофон недоступен. Разрешите доступ к микрофону '
            'и коснитесь сферы, чтобы попробовать снова.';
      });
      return;
    }

    setState(() {
      _phase = _Phase.listening;
      _heard = '';
    });

    final text = await JarvisListen.listenOnce();
    if (_closing || !mounted) return;

    if (text.trim().isEmpty) {
      // Ничего не расслышали — вернёмся в покой, ждём касания.
      setState(() {
        _phase = _Phase.idle;
        _reply = 'Не расслышал. Коснитесь сферы и скажите ещё раз.';
      });
      return;
    }

    await _process(text.trim());
  }

  Future<void> _process(String text) async {
    setState(() {
      _phase = _Phase.thinking;
      _heard = text;
      _history.add(JarvisMessage('user', text));
    });

    final state = context.read<AppState>();
    try {
      final reply = await JarvisService.ask(
        systemPrompt: _buildSystemPrompt(state),
        history: _history,
        exec: (name, args) => _executeTool(state, name, args),
      );
      if (_closing || !mounted) return;

      final finalReply = reply.isEmpty ? 'Готово.' : reply;
      _history.add(JarvisMessage('assistant', finalReply));

      setState(() {
        _phase = _Phase.speaking;
        _reply = finalReply;
      });
      if (state.voiceEnabled) {
        await JarvisVoice.speakAndWait(finalReply);
      }
      if (_closing || !mounted) return;

      // Продолжаем разговор: снова слушаем.
      _listen();
    } catch (e) {
      if (_closing || !mounted) return;
      setState(() {
        _phase = _Phase.error;
        _reply = 'Не смог выполнить запрос. Коснитесь сферы, чтобы повторить.';
      });
    }
  }

  /// Касание сферы: главный переключатель.
  Future<void> _onOrbTap() async {
    switch (_phase) {
      case _Phase.listening:
        // Пользователь закончил говорить — остановить и обработать.
        await JarvisListen.stop();
        break;
      case _Phase.speaking:
        // Перебить JARVIS и начать слушать.
        await JarvisVoice.stop();
        _listen();
        break;
      case _Phase.idle:
      case _Phase.error:
        _listen();
        break;
      case _Phase.greeting:
      case _Phase.thinking:
      case _Phase.disabled:
        break; // занят — игнорируем
    }
  }

  String _buildSystemPrompt(AppState state) {
    final today = DateFormat('yyyy-MM-dd (EEEE)', 'ru').format(DateTime.now());
    final devs = state.developers.map((m) => m.name).join(', ');
    final meName = state.me?.name ?? 'сотрудник';
    final meRole = state.me?.isBoss == true ? 'босс' : 'разработчик';
    return '''
Ты — JARVIS (Чарльз), голосовой ИИ-ассистент управления проектами компании BaiTech.
Сегодня $today. Разговариваешь с пользователем: $meName ($meRole).
Исполнители в команде: ${devs.isEmpty ? '(пока никого)' : devs}.

Это ГОЛОСОВОЙ разговор. Отвечай ОЧЕНЬ коротко — 1–2 предложения, как в живой речи,
без списков, markdown и лишних слов. Никакой светской беседы и новостей.
Отвечай на том языке, на котором говорит пользователь (казахский или русский).
Всегда используй инструменты для действий над проектами — не выдумывай ответ,
если его можно получить или проверить вызовом.
Если данных для действия не хватает — задай ОДИН короткий уточняющий вопрос.
Дедлайны переводи в формат YYYY-MM-DD относительно сегодняшней даты
(«до пятницы», «завтра», «через неделю»).''';
  }

  // ── Исполнитель инструментов (мозг проектов) ─────────────────────────────

  Future<String> _executeTool(
      AppState state, String name, Map<String, dynamic> args) async {
    switch (name) {
      case 'list_projects':
        return _toolListProjects(state, args);
      case 'create_project':
        return _toolCreateProject(state, args);
      case 'update_project':
        return _toolUpdateProject(state, args);
      case 'delete_project':
        return _toolDeleteProject(state, args);
      case 'team_overview':
        return _toolTeamOverview(state);
      case 'expenses_summary':
        return _toolExpensesSummary(state, args);
    }
    return 'Неизвестный инструмент: $name';
  }

  String _toolListProjects(AppState state, Map<String, dynamic> args) {
    final statusArg = (args['status'] as String?)?.toLowerCase();
    final assigneeArg = args['assignee'] as String?;
    ProjectStatus? statusFilter;
    if (statusArg != null && statusArg != 'all') {
      statusFilter = ProjectStatus.values.firstWhere(
        (s) => s.db == statusArg,
        orElse: () => ProjectStatus.todo,
      );
    }
    final assignee = _findMember(state, assigneeArg);

    var list = state.projects;
    if (statusFilter != null) {
      list = list.where((p) => p.status == statusFilter).toList();
    }
    if (assignee != null) {
      list = list.where((p) => p.assigneeId == assignee.id).toList();
    }

    if (list.isEmpty) return 'Проектов по этим фильтрам нет.';

    final fmt = DateFormat('d MMM', 'ru');
    final lines = <String>['Найдено ${list.length}:'];
    for (final p in list.take(15)) {
      final who = state.memberById(p.assigneeId)?.name ?? '—';
      final dl = p.deadline == null ? '' : ' · до ${fmt.format(p.deadline!)}';
      lines.add('• ${p.title} · ${p.status.label} · $who$dl');
    }
    if (list.length > 15) lines.add('… и ещё ${list.length - 15}.');
    return lines.join('\n');
  }

  Future<String> _toolCreateProject(
      AppState state, Map<String, dynamic> args) async {
    if (state.me == null) return 'Сначала войди как участник команды.';
    final title = (args['title'] as String?)?.trim();
    if (title == null || title.isEmpty) return 'Нужно название проекта.';
    final assignee = _findMember(state, args['assignee'] as String?);
    final deadline = _parseDate(args['deadline'] as String?);

    final p = await state.createProject(
      title: title,
      description: (args['description'] as String?)?.trim(),
      assigneeId: assignee?.id,
      deadline: deadline,
    );
    final who = assignee == null ? 'без исполнителя' : 'для ${assignee.name}';
    final when = deadline == null
        ? ''
        : ', дедлайн ${DateFormat('d MMM yyyy', 'ru').format(deadline)}';
    return 'Создан проект «${p.title}» ($who$when).';
  }

  Future<String> _toolUpdateProject(
      AppState state, Map<String, dynamic> args) async {
    if (state.me == null) return 'Сначала войди как участник команды.';
    final query = (args['query'] as String?)?.trim();
    if (query == null || query.isEmpty) return 'Нужно название проекта.';
    final project = _findProject(state, query);
    if (project == null) return 'Проект «$query» не найден.';

    final statusArg = (args['status'] as String?)?.toLowerCase();
    final assigneeArg = args['assignee'] as String?;
    final deadlineArg = (args['deadline'] as String?)?.trim();

    final changes = <String>[];

    if (statusArg != null) {
      final newStatus = ProjectStatus.values.firstWhere(
        (s) => s.db == statusArg,
        orElse: () => project.status,
      );
      if (newStatus != project.status) {
        await state.setStatus(project, newStatus);
        changes.add('статус → ${newStatus.label}');
      }
    }

    final patch = <String, dynamic>{};
    if (assigneeArg != null) {
      final assignee = _findMember(state, assigneeArg);
      if (assignee == null) return 'Не нашёл исполнителя «$assigneeArg».';
      patch['assignee_id'] = assignee.id;
      changes.add('исполнитель → ${assignee.name}');
    }
    if (deadlineArg != null) {
      if (deadlineArg.toLowerCase() == 'none') {
        patch['deadline'] = null;
        changes.add('дедлайн снят');
      } else {
        final d = _parseDate(deadlineArg);
        if (d == null) return 'Не разобрал дату «$deadlineArg».';
        patch['deadline'] = d.toUtc().toIso8601String();
        changes.add('дедлайн → ${DateFormat('d MMM yyyy', 'ru').format(d)}');
      }
    }

    if (patch.isNotEmpty) {
      await state.updateProject(project, patch,
          activity: 'изменил(а) через JARVIS');
    }

    if (changes.isEmpty) return 'Изменений нет — всё уже так.';
    return '«${project.title}»: ${changes.join(', ')}.';
  }

  Future<String> _toolDeleteProject(
      AppState state, Map<String, dynamic> args) async {
    final query = (args['query'] as String?)?.trim();
    if (query == null || query.isEmpty) return 'Нужно название проекта.';
    final project = _findProject(state, query);
    if (project == null) return 'Проект «$query» не найден.';
    await state.deleteProject(project);
    return 'Проект «${project.title}» удалён.';
  }

  String _toolTeamOverview(AppState state) {
    final devs = state.developers;
    if (devs.isEmpty) return 'В команде пока нет разработчиков.';
    final open = state.openByDeveloper();
    final done = state.doneByDeveloper();
    final lines = <String>['Нагрузка команды:'];
    for (final dev in devs) {
      lines.add(
          '• ${dev.name}: открыто ${open[dev] ?? 0}, закрыто ${done[dev] ?? 0}');
    }
    return lines.join('\n');
  }

  String _toolExpensesSummary(AppState state, Map<String, dynamic> args) {
    final months = (args['months'] as int?) ?? 1;
    final safeMonths = [1, 3, 12].contains(months) ? months : 1;
    final multiplier = safeMonths;
    final combinedUsd = state.combinedUsd(1) * multiplier;
    final combinedKzt = state.combinedKzt(1) * multiplier;
    final period = safeMonths == 1
        ? 'месяц'
        : safeMonths == 3
            ? '3 месяца (прогноз ×3)'
            : 'год (прогноз ×12)';
    final usdFmt = combinedUsd.toStringAsFixed(
        combinedUsd == combinedUsd.roundToDouble() ? 0 : 2);
    final kztFmt = NumberFormat('#,##0', 'ru').format(combinedKzt);
    return 'Расходы за $period: ≈ \$$usdFmt · ₸$kztFmt.';
  }

  Member? _findMember(AppState state, String? nameQuery) {
    final q = nameQuery?.trim().toLowerCase();
    if (q == null || q.isEmpty) return null;
    for (final m in state.members) {
      if (m.name.toLowerCase() == q) return m;
    }
    for (final m in state.members) {
      if (m.name.toLowerCase().contains(q) ||
          q.contains(m.name.toLowerCase())) {
        return m;
      }
    }
    return null;
  }

  Project? _findProject(AppState state, String query) {
    final q = query.toLowerCase();
    for (final p in state.projects) {
      if (p.title.toLowerCase() == q) return p;
    }
    for (final p in state.projects) {
      if (p.title.toLowerCase().contains(q)) return p;
    }
    return null;
  }

  DateTime? _parseDate(String? raw) {
    if (raw == null) return null;
    final s = raw.trim();
    if (s.isEmpty || s.toLowerCase() == 'none') return null;
    try {
      return DateTime.parse(s);
    } catch (_) {
      return null;
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  _OrbState get _orbState {
    switch (_phase) {
      case _Phase.listening:
        return _OrbState.listening;
      case _Phase.thinking:
        return _OrbState.thinking;
      case _Phase.speaking:
      case _Phase.greeting:
        return _OrbState.speaking;
      case _Phase.idle:
      case _Phase.error:
      case _Phase.disabled:
        return _OrbState.idle;
    }
  }

  String get _statusLine {
    switch (_phase) {
      case _Phase.greeting:
      case _Phase.speaking:
        return 'JARVIS говорит…';
      case _Phase.listening:
        return 'Слушаю…';
      case _Phase.thinking:
        return 'Думаю…';
      case _Phase.idle:
        return 'Коснитесь сферы, чтобы говорить';
      case _Phase.error:
        return 'Нужно ваше действие';
      case _Phase.disabled:
        return 'JARVIS недоступен';
    }
  }

  Future<void> _close() async {
    _closing = true;
    await JarvisListen.cancel();
    await JarvisVoice.stop();
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    // Активная реплика под орбом: пока слушаем — показываем распознаваемый
    // текст пользователя, иначе — последний ответ/подсказку JARVIS.
    final caption = _phase == _Phase.listening
        ? (_heard.isEmpty ? '' : _heard)
        : _reply;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                _topBar(state),
                const Spacer(),
                GestureDetector(
                  onTap: _onOrbTap,
                  behavior: HitTestBehavior.opaque,
                  child: SizedBox(
                    width: 300,
                    height: 300,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        _JarvisOrb(orbState: _orbState),
                        // Надпись JARVIS в центре роя частиц.
                        Text(
                          'JARVIS',
                          style: TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w300,
                            letterSpacing: 8,
                            color: Colors.white.withValues(alpha: 0.85),
                            shadows: const [
                              Shadow(color: AppColors.cyan, blurRadius: 18),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 36),
                Text(
                  _statusLine,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: AppColors.cyan,
                  ),
                ),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 220),
                    child: Text(
                      caption,
                      key: ValueKey(caption),
                      textAlign: TextAlign.center,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 18,
                        height: 1.4,
                        fontWeight: FontWeight.w500,
                        color: _phase == _Phase.listening
                            ? AppColors.textPrimary
                            : AppColors.textSecondary,
                      ),
                    ),
                  ),
                ),
                const Spacer(),
                _bottomHint(),
                const SizedBox(height: 28),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _topBar(AppState state) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
      child: Row(
        children: [
          const Text(
            'JARVIS',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
            ),
          ),
          const Spacer(),
          IconButton(
            tooltip: state.voiceEnabled ? 'Выключить голос' : 'Включить голос',
            icon: Icon(
              state.voiceEnabled
                  ? Icons.graphic_eq_rounded
                  : Icons.volume_off_rounded,
              color:
                  state.voiceEnabled ? AppColors.cyan : AppColors.textSecondary,
            ),
            onPressed: () {
              final next = !state.voiceEnabled;
              context.read<AppState>().setVoiceEnabled(next);
              if (!next) JarvisVoice.stop();
            },
          ),
          IconButton(
            tooltip: 'Закрыть',
            icon: const Icon(Icons.close_rounded, size: 28),
            onPressed: _close,
          ),
        ],
      ),
    );
  }

  Widget _bottomHint() {
    final tapping = _phase == _Phase.listening;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          tapping ? Icons.stop_circle_rounded : Icons.mic_rounded,
          size: 18,
          color: AppColors.textSecondary,
        ),
        const SizedBox(width: 8),
        Text(
          tapping ? 'Коснитесь, когда закончите' : 'Просто говорите с JARVIS',
          style: const TextStyle(
            fontSize: 13,
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

// ── JARVIS Orb (нативное ядро-реактор) ────────────────────────────────────────
//
// Полностью векторный орб на CustomPainter — без видео и platform-view, поэтому
// плавно идёт 60 fps даже на iPhone 12 в вебе (никакого декодирования кадров).
// Два постоянных контроллера задают непрерывное вращение и «дыхание», а фаза
// диалога влияет только на ВНЕШНИЙ ВИД через плавно анимируемую «энергию»:
// • idle      — покой, тускло, медленный дрейф
// • listening — оживает, ровное дыхание
// • thinking  — ярче, дуги раскручиваются
// • speaking  — максимум энергии, пульсация вокруг ядра
//
// Скорость вращения постоянна (энергия меняет только цвет/яркость/пульс), поэтому
// переходы между фазами всегда плавные, без рывков.

class _JarvisOrb extends StatefulWidget {
  final _OrbState orbState;
  const _JarvisOrb({required this.orbState});

  @override
  State<_JarvisOrb> createState() => _JarvisOrbState();
}

class _JarvisOrbState extends State<_JarvisOrb>
    with TickerProviderStateMixin {
  late final AnimationController _spin =
      AnimationController(vsync: this, duration: const Duration(seconds: 18))
        ..repeat();
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..repeat(reverse: true);

  /// Целевая «энергия» орба для каждой фазы (0..1). Анимируется плавно.
  static const _energyFor = <_OrbState, double>{
    _OrbState.idle: 0.28,
    _OrbState.listening: 0.55,
    _OrbState.thinking: 0.82,
    _OrbState.speaking: 1.0,
  };

  @override
  void dispose() {
    _spin.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final target = _energyFor[widget.orbState] ?? 0.28;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: target),
      duration: const Duration(milliseconds: 650),
      curve: Curves.easeOutCubic,
      builder: (context, energy, _) {
        return RepaintBoundary(
          child: CustomPaint(
            size: const Size(300, 300),
            painter: _OrbPainter(
              spin: _spin,
              pulse: _pulse,
              energy: energy,
            ),
          ),
        );
      },
    );
  }
}

/// Рисует ядро-реактор: внешнее свечение, вращающиеся дуги/тики HUD,
/// орбитальные точки и пульсирующий центр. Всё — векторно.
class _OrbPainter extends CustomPainter {
  final Animation<double> spin;
  final Animation<double> pulse;
  final double energy;

  _OrbPainter({
    required this.spin,
    required this.pulse,
    required this.energy,
  }) : super(repaint: Listenable.merge([spin, pulse]));

  static const _cyan = AppColors.cyan;
  static const _tau = 2 * math.pi;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final maxR = size.shortestSide / 2;
    final t = spin.value * _tau; // непрерывная фаза вращения
    final breathe = Curves.easeInOut.transform(pulse.value); // 0..1
    final e = energy;
    final bright = Color.lerp(_cyan, Colors.white, 0.35 * e)!;

    // 1. Внешнее свечение (радиальный градиент).
    final glowR = maxR * (0.94 + 0.05 * breathe * e);
    canvas.drawCircle(
      center,
      glowR,
      Paint()
        ..shader = RadialGradient(
          colors: [
            bright.withValues(alpha: 0.10 + 0.26 * e),
            _cyan.withValues(alpha: 0.04 + 0.10 * e),
            Colors.transparent,
          ],
          stops: const [0.0, 0.55, 1.0],
        ).createShader(Rect.fromCircle(center: center, radius: glowR)),
    );

    // 2. Тонкие концентрические кольца (спокойный каркас).
    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = _cyan.withValues(alpha: 0.05 + 0.06 * e);
    for (final r in const [0.36, 0.55, 0.74]) {
      canvas.drawCircle(center, maxR * r, ringPaint);
    }

    // 3. HUD-тики по внешнему ободу (медленно вращаются).
    final rim = maxR * 0.9;
    final tickPaint = Paint()
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 1.5
      ..color = _cyan.withValues(alpha: 0.16 + 0.34 * e);
    const ticks = 60;
    for (var i = 0; i < ticks; i++) {
      final a = t * 0.5 + i / ticks * _tau;
      final long = i % 5 == 0;
      final r1 = rim - (long ? 11 : 5);
      final dx = math.cos(a), dy = math.sin(a);
      canvas.drawLine(
        center + Offset(dx * r1, dy * r1),
        center + Offset(dx * rim, dy * rim),
        tickPaint,
      );
    }

    // 4. Вращающиеся дуги-сегменты на разных радиусах и в разные стороны.
    void arc(double rFrac, double startFrac, double sweepFrac, double speed,
        double width, double alpha) {
      final start = t * speed + startFrac * _tau;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: maxR * rFrac),
        start,
        sweepFrac * _tau,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeWidth = width
          ..color = bright.withValues(alpha: alpha * (0.35 + 0.65 * e)),
      );
    }

    arc(0.74, 0.00, 0.16, 1.0, 3.0, 0.85);
    arc(0.74, 0.52, 0.09, 1.0, 3.0, 0.55);
    arc(0.55, 0.20, 0.28, -0.72, 2.6, 0.80);
    arc(0.55, 0.78, 0.07, -0.72, 2.6, 0.45);
    arc(0.36, 0.10, 0.42, 1.55, 2.2, 0.70);

    // 5. Орбитальные точки на среднем радиусе.
    final dotPaint = Paint()
      ..color = bright.withValues(alpha: 0.55 + 0.45 * e);
    for (var i = 0; i < 3; i++) {
      final a = -t * 1.3 + i / 3 * _tau;
      final p = center + Offset(math.cos(a), math.sin(a)) * (maxR * 0.74);
      canvas.drawCircle(p, 2.2 + 2.0 * e, dotPaint);
    }

    // 6. Пульсирующее ядро — свечение-кольцо, центр остаётся тёмным,
    //    чтобы надпись «JARVIS» поверх орба читалась.
    final coreR = maxR * (0.30 + 0.03 * breathe * (0.5 + e));
    canvas.drawCircle(
      center,
      coreR,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.transparent,
            _cyan.withValues(alpha: 0.06 * e),
            bright.withValues(alpha: 0.30 + 0.45 * e),
            Colors.transparent,
          ],
          stops: const [0.0, 0.35, 0.72, 1.0],
        ).createShader(Rect.fromCircle(center: center, radius: coreR)),
    );

    // 7. Всплески при разговоре: расходящееся кольцо (заметно на высокой энергии).
    if (e > 0.6) {
      final rippleT = pulse.value; // 0..1
      final rippleR = maxR * (0.30 + 0.6 * rippleT);
      canvas.drawCircle(
        center,
        rippleR,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = bright.withValues(alpha: (1 - rippleT) * 0.5 * (e - 0.6) / 0.4),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _OrbPainter old) => old.energy != energy;
}
