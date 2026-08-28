import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

/// Экран входа: выбираешь, кто ты — Босс, Ахад или Руслан.
class ProfilePickerScreen extends StatelessWidget {
  const ProfilePickerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.bg, AppColors.bgDark],
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Spacer(),
                ShaderMask(
                  shaderCallback: (b) =>
                      AppColors.accentGradient.createShader(b),
                  child: const Text(
                    'BAITECH',
                    style: TextStyle(
                      fontSize: 42,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 4,
                      color: Colors.white,
                    ),
                  ),
                ),
                const Text(
                  'Projects Dashboard',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 16,
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 40),
                const Text(
                  'Кто ты?',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 16),
                if (state.members.isEmpty && !state.loading)
                  const Text(
                    'Нет соединения с сервером.\nПроверь интернет и перезапусти.',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                ...state.members.indexed.map(
                  (entry) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child:
                        _MemberTile(member: entry.$2, autofocus: entry.$1 == 0),
                  ),
                ),
                const Spacer(flex: 2),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  final Member member;
  final bool autofocus;
  const _MemberTile({required this.member, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    return DarkCard(
      autofocus: autofocus,
      onTap: () => context.read<AppState>().selectMember(member),
      child: Row(
        children: [
          MemberAvatar(member: member, radius: 24),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  member.name,
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700),
                ),
                Text(
                  member.isBoss ? 'Руководитель' : 'Программист',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13),
                ),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios_rounded,
              size: 16, color: AppColors.textSecondary),
        ],
      ),
    );
  }
}
