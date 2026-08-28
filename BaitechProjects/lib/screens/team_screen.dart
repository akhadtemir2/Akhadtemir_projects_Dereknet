import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

/// Команда: телефоны, быстрый звонок, редактирование номера.
class TeamScreen extends StatelessWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
        children: [
          const Text(
            'Команда',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            'Нажми на трубку, чтобы позвонить. Долгое нажатие — изменить номер.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: 18),
          ...state.members.indexed.map(
            (entry) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _MemberCard(member: entry.$2, autofocus: entry.$1 == 0),
            ),
          ),
        ],
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  final Member member;
  final bool autofocus;
  const _MemberCard({required this.member, this.autofocus = false});

  Future<void> _editPhone(BuildContext context) async {
    final ctrl = TextEditingController(text: member.phone ?? '');
    final phone = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Номер — ${member.name}'),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(hintText: '+7 777 123 45 67'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Сохранить',
                style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (phone != null && context.mounted) {
      await context.read<AppState>().setMemberPhone(member, phone);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final openCount = state.projects
        .where(
            (p) => p.assigneeId == member.id && p.status != ProjectStatus.done)
        .length;

    return DarkCard(
      autofocus: autofocus,
      onLongPress: () => _editPhone(context),
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
                  member.isBoss
                      ? 'Руководитель'
                      : 'Программист · $openCount активных',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13),
                ),
                if ((member.phone ?? '').isNotEmpty)
                  Text(
                    member.phone!,
                    style: const TextStyle(color: AppColors.cyan, fontSize: 13),
                  ),
              ],
            ),
          ),
          GradientIconButton(
            icon: Icons.call_rounded,
            size: 46,
            active: (member.phone ?? '').isNotEmpty,
            onTap: () => MemberAvatar.call(context, member),
          ),
        ],
      ),
    );
  }
}
