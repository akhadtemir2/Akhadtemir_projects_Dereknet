import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';
import 'expenses_screen.dart';
import 'home_screen.dart';
import 'jarvis_screen.dart';
import 'team_screen.dart';

/// Версия приложения — видна в «Профиле», чтобы проверять, что обновление доехало.
const kAppVersion = 'v1.6.0';

/// Каркас приложения: нижняя навигация со вкладками
/// Проекты · Расходы · [JARVIS] · Команда · Профиль.
///
/// Центральная кнопка — вкладка JARVIS (ИИ-ассистент управления проектами):
/// она флагман приложения, поэтому занимает центральное место в баре.
/// Создание проекта — из шапки экрана «Проекты» (тот же UX, что и у «+»
/// расходов в шапке «Расходов»), а не FAB.
class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  /// Открывает JARVIS во весь экран (не вкладка): нажал центральную кнопку —
  /// появился голосовой ассистент, поздоровался и слушает. «Закрыть» — назад.
  void _openJarvis() {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: true,
        transitionDuration: const Duration(milliseconds: 260),
        pageBuilder: (_, __, ___) => const JarvisScreen(),
        transitionsBuilder: (_, anim, __, child) => FadeTransition(
          opacity: anim,
          child: child,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    const pages = [
      HomeScreen(),
      ExpensesScreen(),
      TeamScreen(),
    ];

    return Scaffold(
      extendBody: true,
      body: Stack(
        children: [
          // диагональный градиентный клин на фоне, как в референсе
          Positioned.fill(
            child: CustomPaint(painter: _WedgePainter()),
          ),
          // IndexedStack держит все вкладки живыми одновременно. Для пульта это
          // ловушка: скрытые вкладки тоже хотят фокус (autofocus) и перехватывают
          // стрелки. ExcludeFocus делает фокусируемой только видимую вкладку.
          IndexedStack(
            index: _index,
            children: [
              for (var i = 0; i < pages.length; i++)
                ExcludeFocus(excluding: _index != i, child: pages[i]),
            ],
          ),
          if (state.offline)
            Positioned(
              top: MediaQuery.of(context).padding.top,
              left: 0,
              right: 0,
              child: Container(
                color: AppColors.yellow.withValues(alpha: 0.9),
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: const Text(
                  'Оффлайн — показаны сохранённые данные',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Colors.black87,
                      fontSize: 12,
                      fontWeight: FontWeight.w600),
                ),
              ),
            ),
        ],
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: _JarvisFab(
        active: false,
        onPressed: _openJarvis,
      ),
      bottomNavigationBar: _NavBar(
        index: _index,
        onChanged: (i) => setState(() => _index = i),
      ),
    );
  }
}

class _WedgePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width, size.height * 0.25)
      ..lineTo(size.width, size.height)
      ..lineTo(size.width * 0.15, size.height)
      ..close();
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
        colors: [Color(0x334B4CED), Color(0x1137B6E9)],
      ).createShader(Offset.zero & size);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _JarvisFab extends StatefulWidget {
  final VoidCallback onPressed;
  final bool active;
  const _JarvisFab({required this.onPressed, required this.active});

  @override
  State<_JarvisFab> createState() => _JarvisFabState();
}

class _JarvisFabState extends State<_JarvisFab> {
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
    return Container(
      width: 62,
      height: 62,
      decoration: BoxDecoration(
        gradient: AppColors.accentGradient,
        borderRadius: BorderRadius.circular(20),
        border: _focused
            ? Border.all(color: kFocusRingColor, width: kFocusRingWidth)
            : widget.active
                ? Border.all(
                    color: Colors.white.withValues(alpha: 0.35), width: 1.5)
                : null,
        boxShadow: [
          BoxShadow(
            color:
                AppColors.indigo.withValues(alpha: widget.active ? 0.7 : 0.5),
            blurRadius: widget.active ? 24 : 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          focusNode: _node,
          borderRadius: BorderRadius.circular(20),
          onTap: widget.onPressed,
          child: const Icon(Icons.auto_awesome_rounded,
              color: Colors.white, size: 30),
        ),
      ),
    );
  }
}

class _NavBar extends StatelessWidget {
  final int index;
  final ValueChanged<int> onChanged;
  const _NavBar({required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    const items = [
      (Icons.dashboard_rounded, 'Проекты'),
      (Icons.account_balance_wallet_rounded, 'Расходы'),
      (Icons.group_rounded, 'Команда'),
    ];
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.bgDark.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.45),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _navItem(0, items[0]),
          _navItem(1, items[1]),
          const SizedBox(width: 62), // место под центральный JARVIS-FAB
          _navItem(2, items[2]),
          _ProfileNavItem(onChanged: onChanged),
        ],
      ),
    );
  }

  Widget _navItem(int i, (IconData, String) item) {
    final active = index == i;
    return FocusableTap(
      onTap: () => onChanged(i),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          active
              ? ShaderMask(
                  shaderCallback: (b) =>
                      AppColors.accentGradient.createShader(b),
                  child: Icon(item.$1, color: Colors.white, size: 26),
                )
              : Icon(item.$1, color: AppColors.textSecondary, size: 26),
          const SizedBox(height: 3),
          Text(
            item.$2,
            style: TextStyle(
              fontSize: 10,
              fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              color: active ? AppColors.cyan : AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileNavItem extends StatelessWidget {
  final ValueChanged<int> onChanged;
  const _ProfileNavItem({required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return FocusableTap(
      onTap: () => showModalBottomSheet(
        context: context,
        builder: (_) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Text(
                'Ты вошёл как ${state.me?.name ?? ''}',
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              ListTile(
                leading:
                    const Icon(Icons.swap_horiz_rounded, color: AppColors.cyan),
                title: const Text('Сменить пользователя'),
                onTap: () {
                  Navigator.pop(context);
                  context.read<AppState>().logout();
                },
              ),
              ListTile(
                leading:
                    const Icon(Icons.refresh_rounded, color: AppColors.cyan),
                title: const Text('Обновить данные'),
                onTap: () {
                  Navigator.pop(context);
                  context.read<AppState>().refresh();
                },
              ),
              const Text(
                'BaiTech Projects $kAppVersion',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: (state.me?.avatarColor ?? AppColors.cyan)
                .withValues(alpha: 0.25),
            child: Text(
              state.me?.name.characters.first.toUpperCase() ?? '?',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: state.me?.avatarColor ?? AppColors.cyan,
              ),
            ),
          ),
          const SizedBox(height: 3),
          const Text(
            'Профиль',
            style: TextStyle(fontSize: 10, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}
