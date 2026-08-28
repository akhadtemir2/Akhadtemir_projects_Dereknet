import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config/secrets.dart';
import 'screens/root_shell.dart';
import 'screens/profile_picker_screen.dart';
import 'state/app_state.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
    url: Secrets.supabaseUrl,
    // ignore: deprecated_member_use
    anonKey: Secrets.supabaseAnonKey,
  );
  // На Smart TV нет мыши/тача — кольцо фокуса должно быть видно всегда,
  // а не только после Tab, как по умолчанию решает Flutter.
  FocusManager.instance.highlightStrategy =
      FocusHighlightStrategy.alwaysTraditional;
  runApp(const BaiTechApp());
}

/// Ключ навигатора нужен, т.к. MaterialApp.builder работает НАД внутренним
/// Navigator — из его context обычный Navigator.of(context) его не найдёт.
final navigatorKey = GlobalKey<NavigatorState>();

/// Кнопка «Назад»/«Возврат» на пульте ТВ приходит в браузер как Escape —
/// закрывает диалоги/шторки и возвращает на предыдущий экран.
class _PopOnBackIntent extends Intent {
  const _PopOnBackIntent();
}

class _TvBackShortcuts extends StatelessWidget {
  final Widget child;
  const _TvBackShortcuts({required this.child});

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.escape): _PopOnBackIntent(),
        SingleActivator(LogicalKeyboardKey.goBack): _PopOnBackIntent(),
        // ВАЖНО ДЛЯ ТВ: на вебе Flutter НЕ вешает стрелки на перемещение
        // фокуса (в браузере они по умолчанию скроллят). Пульт Smart TV шлёт
        // именно стрелки (D-pad), поэтому маппим их вручную на направленный
        // фокус. В текстовых полях стрелки перехватываются раньше (двигают
        // курсор), сюда доходят только вне полей ввода.
        SingleActivator(LogicalKeyboardKey.arrowUp):
            DirectionalFocusIntent(TraversalDirection.up),
        SingleActivator(LogicalKeyboardKey.arrowDown):
            DirectionalFocusIntent(TraversalDirection.down),
        SingleActivator(LogicalKeyboardKey.arrowLeft):
            DirectionalFocusIntent(TraversalDirection.left),
        SingleActivator(LogicalKeyboardKey.arrowRight):
            DirectionalFocusIntent(TraversalDirection.right),
      },
      child: Actions(
        actions: {
          _PopOnBackIntent: CallbackAction<_PopOnBackIntent>(
            onInvoke: (_) => navigatorKey.currentState?.maybePop(),
          ),
        },
        child: child,
      ),
    );
  }
}

class BaiTechApp extends StatelessWidget {
  const BaiTechApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AppState()..init(),
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'BaiTech Projects',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        locale: const Locale('ru'),
        supportedLocales: const [Locale('ru'), Locale('en')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) =>
            _TvBackShortcuts(child: child ?? const SizedBox.shrink()),
        home: const _Gate(),
      ),
    );
  }
}

class _Gate extends StatelessWidget {
  const _Gate();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (state.loading && state.members.isEmpty) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(color: AppColors.cyan),
        ),
      );
    }
    if (state.me == null) return const ProfilePickerScreen();
    return const RootShell();
  }
}
