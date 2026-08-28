import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../screens/project_detail_screen.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import 'common.dart';

/// Карточка проекта в списке (стиль карточек товаров из референса).
class ProjectCard extends StatelessWidget {
  final Project project;
  final bool autofocus;
  const ProjectCard({super.key, required this.project, this.autofocus = false});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final assignee = state.memberById(project.assigneeId);

    return DarkCard(
      padding: const EdgeInsets.all(14),
      autofocus: autofocus,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ProjectDetailScreen(projectId: project.id),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Cover(url: project.coverUrl, status: project.status),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        project.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    MemberAvatar(member: assignee, radius: 14),
                  ],
                ),
                if ((project.description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    project.description!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 13,
                      height: 1.35,
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    StatusChip(status: project.status),
                    DeadlineBadge(project: project),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Cover extends StatelessWidget {
  final String? url;
  final ProjectStatus status;
  const _Cover({required this.url, required this.status});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 74,
        height: 74,
        color: AppColors.bgDark,
        child: url != null
            ? Image.network(
                url!,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => _placeholder(),
              )
            : _placeholder(),
      ),
    );
  }

  Widget _placeholder() => Center(
        child: ShaderMask(
          shaderCallback: (b) => AppColors.accentGradient.createShader(b),
          child: Icon(
            status == ProjectStatus.done
                ? Icons.verified_rounded
                : Icons.rocket_launch_rounded,
            color: Colors.white,
            size: 30,
          ),
        ),
      );
}
