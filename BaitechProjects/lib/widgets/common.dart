import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../theme/app_theme.dart';

/// Толщина и цвет кольца фокуса — единый язык для навигации пультом ТВ
/// (нет курсора/наведения, поэтому фокус должен быть хорошо виден издалека).
const kFocusRingColor = AppColors.cyan;
const kFocusRingWidth = 2.5;

/// Оборачивает произвольный виджет в фокусируемую/кликабельную область:
/// доступна с пульта (стрелки — перемещение, OK/Enter — активация),
/// показывает кольцо фокуса и проматывает список так, чтобы фокус был виден.
class FocusableTap extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool autofocus;
  final BorderRadius borderRadius;

  const FocusableTap({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.autofocus = false,
    this.borderRadius = const BorderRadius.all(Radius.circular(14)),
  });

  @override
  State<FocusableTap> createState() => _FocusableTapState();
}

class _FocusableTapState extends State<FocusableTap> {
  final _node = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node.addListener(_handleFocusChange);
  }

  void _handleFocusChange() {
    if (!mounted) return;
    setState(() => _focused = _node.hasPrimaryFocus);
    if (_node.hasPrimaryFocus) {
      // сфокусированный элемент может быть проскроллен за пределы экрана
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = context;
        if (mounted && Scrollable.maybeOf(ctx) != null) {
          Scrollable.ensureVisible(ctx,
              alignment: 0.5, duration: const Duration(milliseconds: 200));
        }
      });
    }
  }

  @override
  void dispose() {
    _node.removeListener(_handleFocusChange);
    _node.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FocusableActionDetector(
      focusNode: _node,
      autofocus: widget.autofocus,
      mouseCursor:
          widget.onTap != null ? SystemMouseCursors.click : MouseCursor.defer,
      // На вебе Flutter НЕ вешает Enter на активацию (в браузере Enter —
      // submit/newline). Кнопка OK пульта ТВ приходит как Enter (иногда
      // Select). Привязываем их явно, чтобы FocusableTap срабатывал по OK
      // так же, как нативный InkWell у карточек.
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.numpadEnter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.select): ActivateIntent(),
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) => widget.onTap?.call(),
        ),
      },
      child: GestureDetector(
        onTap: widget.onTap,
        onLongPress: widget.onLongPress,
        behavior: HitTestBehavior.opaque,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: widget.borderRadius,
            border: _focused
                ? Border.all(color: kFocusRingColor, width: kFocusRingWidth)
                : null,
          ),
          child: widget.child,
        ),
      ),
    );
  }
}

/// Кнопка с фирменным градиентом (как «Add to Cart» в референсе).
class GradientButton extends StatefulWidget {
  final String label;
  final VoidCallback? onTap;
  final IconData? icon;
  final EdgeInsets padding;
  final bool autofocus;

  const GradientButton({
    super.key,
    required this.label,
    this.onTap,
    this.icon,
    this.padding = const EdgeInsets.symmetric(horizontal: 24, vertical: 15),
    this.autofocus = false,
  });

  @override
  State<GradientButton> createState() => _GradientButtonState();
}

class _GradientButtonState extends State<GradientButton> {
  final _node = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node.addListener(() {
      if (mounted) setState(() => _focused = _node.hasPrimaryFocus);
    });
  }

  @override
  void dispose() {
    _node.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: BoxDecoration(
            gradient: AppColors.accentGradient,
            borderRadius: BorderRadius.circular(16),
            border: _focused
                ? Border.all(color: kFocusRingColor, width: kFocusRingWidth)
                : null,
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: AppColors.indigo.withValues(alpha: 0.45),
                      blurRadius: 18,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : null,
          ),
          child: InkWell(
            focusNode: _node,
            autofocus: widget.autofocus,
            borderRadius: BorderRadius.circular(16),
            onTap: widget.onTap,
            child: Padding(
              padding: widget.padding,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (widget.icon != null) ...[
                    Icon(widget.icon, size: 20, color: Colors.white),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    widget.label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Квадратная иконка-кнопка с градиентом (как кнопка поиска в референсе).
class GradientIconButton extends StatefulWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final double size;
  final bool active;
  final bool autofocus;

  const GradientIconButton({
    super.key,
    required this.icon,
    this.onTap,
    this.size = 52,
    this.active = true,
    this.autofocus = false,
  });

  @override
  State<GradientIconButton> createState() => _GradientIconButtonState();
}

class _GradientIconButtonState extends State<GradientIconButton> {
  final _node = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node.addListener(() {
      if (mounted) setState(() => _focused = _node.hasPrimaryFocus);
    });
  }

  @override
  void dispose() {
    _node.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Ink(
        width: widget.size,
        height: widget.size,
        decoration: BoxDecoration(
          gradient: widget.active ? AppColors.accentGradient : null,
          color: widget.active ? null : AppColors.surface,
          borderRadius: BorderRadius.circular(widget.size * 0.31),
          border: _focused
              ? Border.all(color: kFocusRingColor, width: kFocusRingWidth)
              : null,
          boxShadow: widget.active
              ? [
                  BoxShadow(
                    color: AppColors.indigo.withValues(alpha: 0.4),
                    blurRadius: 14,
                    offset: const Offset(0, 5),
                  ),
                ]
              : null,
        ),
        child: InkWell(
          focusNode: _node,
          autofocus: widget.autofocus,
          borderRadius: BorderRadius.circular(widget.size * 0.31),
          onTap: widget.onTap,
          child: Icon(widget.icon,
              color: widget.active ? Colors.white : AppColors.textSecondary,
              size: widget.size * 0.46),
        ),
      ),
    );
  }
}

/// Индикатор дедлайна: зелёный — времени много, жёлтый — завтра/послезавтра,
/// красный пульсирующий — просрочен.
class DeadlineBadge extends StatefulWidget {
  final Project project;
  final bool compact;

  const DeadlineBadge({super.key, required this.project, this.compact = false});

  @override
  State<DeadlineBadge> createState() => _DeadlineBadgeState();
}

class _DeadlineBadgeState extends State<DeadlineBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
    lowerBound: 0.45,
    upperBound: 1,
  );

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.project;
    final days = p.daysLeft;
    if (days == null) return const SizedBox.shrink();

    final done = p.status == ProjectStatus.done;
    Color color;
    String label;
    if (done) {
      color = AppColors.green;
      label = 'сдано';
    } else if (days < 0) {
      color = AppColors.red;
      label = 'просрочен ${-days} дн.';
    } else if (days == 0) {
      color = AppColors.red;
      label = 'сегодня!';
    } else if (days <= 2) {
      color = AppColors.yellow;
      label = days == 1 ? 'завтра' : 'через $days дн.';
    } else {
      color = AppColors.green;
      label = 'через $days дн.';
    }

    final overdue = !done && days <= 0;
    if (overdue && !_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    } else if (!overdue && _pulse.isAnimating) {
      _pulse.stop();
      _pulse.value = 1;
    }

    final dot = FadeTransition(
      opacity: _pulse,
      child: Container(
        width: 9,
        height: 9,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(color: color.withValues(alpha: 0.6), blurRadius: 7),
          ],
        ),
      ),
    );

    if (widget.compact) return dot;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          dot,
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
                color: color, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// Чип статуса проекта.
class StatusChip extends StatelessWidget {
  final ProjectStatus status;
  const StatusChip({super.key, required this.status});

  Color get _color => switch (status) {
        ProjectStatus.todo => AppColors.cyan,
        ProjectStatus.inProgress => AppColors.yellow,
        ProjectStatus.done => AppColors.green,
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(status.icon, size: 14, color: _color),
          const SizedBox(width: 5),
          Text(
            status.label,
            style: TextStyle(
                color: _color, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// Аватар участника; по тапу — системный звонок (tel:), если есть номер.
class MemberAvatar extends StatelessWidget {
  final Member? member;
  final double radius;
  final bool callOnTap;

  const MemberAvatar({
    super.key,
    required this.member,
    this.radius = 16,
    this.callOnTap = false,
  });

  static Future<void> call(BuildContext context, Member m) async {
    final phone = m.phone;
    if (phone == null || phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('У ${m.name} не указан номер (вкладка «Команда»)')),
      );
      return;
    }
    final uri = Uri.parse('tel:$phone');
    if (!await launchUrl(uri)) {
      // ignore: use_build_context_synchronously
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Номер: $phone')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = member;
    if (m == null) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: AppColors.surface,
        child: Icon(Icons.person_off_rounded,
            size: radius, color: AppColors.textSecondary),
      );
    }
    final avatar = CircleAvatar(
      radius: radius,
      backgroundColor: m.avatarColor.withValues(alpha: 0.25),
      child: Text(
        m.name.characters.first.toUpperCase(),
        style: TextStyle(
          color: m.avatarColor,
          fontWeight: FontWeight.w700,
          fontSize: radius * 0.9,
        ),
      ),
    );
    if (!callOnTap) return avatar;
    return FocusableTap(
      borderRadius: BorderRadius.circular(radius),
      onTap: () => call(context, m),
      child: avatar,
    );
  }
}

/// Тёмная карточка-«стекло» как в референсе.
class DarkCard extends StatefulWidget {
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool autofocus;

  const DarkCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.onLongPress,
    this.autofocus = false,
  });

  @override
  State<DarkCard> createState() => _DarkCardState();
}

class _DarkCardState extends State<DarkCard> {
  final _node = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node.addListener(_handleFocusChange);
  }

  bool get _interactive => widget.onTap != null || widget.onLongPress != null;

  void _handleFocusChange() {
    if (!mounted) return;
    // hasPrimaryFocus (не hasFocus): кольцо только когда фокус на самой
    // карточке, а не на вложенном элементе (например таб внутри карточки).
    setState(() => _focused = _node.hasPrimaryFocus);
    if (_node.hasPrimaryFocus) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = context;
        if (mounted && Scrollable.maybeOf(ctx) != null) {
          Scrollable.ensureVisible(ctx,
              alignment: 0.5, duration: const Duration(milliseconds: 200));
        }
      });
    }
  }

  @override
  void dispose() {
    _node.removeListener(_handleFocusChange);
    _node.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Ink(
        decoration: BoxDecoration(
          gradient: AppColors.cardGradient,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: _focused
                ? kFocusRingColor
                : Colors.white.withValues(alpha: 0.05),
            width: _focused ? kFocusRingWidth : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.35),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: InkWell(
          focusNode: _node,
          autofocus: widget.autofocus,
          // Некликабельная карточка (без onTap/onLongPress) не должна быть
          // остановкой фокуса при навигации пультом — иначе подсвечивается зря.
          canRequestFocus: _interactive,
          borderRadius: BorderRadius.circular(24),
          onTap: widget.onTap,
          onLongPress: widget.onLongPress,
          child: Padding(padding: widget.padding, child: widget.child),
        ),
      ),
    );
  }
}
