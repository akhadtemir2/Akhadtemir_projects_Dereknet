import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';
import '../widgets/project_card.dart';
import 'project_form_screen.dart';

/// Главный экран: заголовок, поиск, вкладки-статусы, список проектов.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  ProjectStatus? _statusFilter; // null = все
  String? _assigneeFilter; // member id
  String _query = '';
  bool _searchOpen = false;
  final _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<Project> _filtered(AppState state) {
    var list = state.projects;
    if (_statusFilter != null) {
      list = list.where((p) => p.status == _statusFilter).toList();
    }
    if (_assigneeFilter != null) {
      list = list.where((p) => p.assigneeId == _assigneeFilter).toList();
    }
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      list = list
          .where((p) =>
              p.title.toLowerCase().contains(q) ||
              (p.description ?? '').toLowerCase().contains(q))
          .toList();
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final projects = _filtered(state);

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.cyan,
        backgroundColor: AppColors.surface,
        onRefresh: () => context.read<AppState>().refresh(),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _searchOpen
                              ? TextField(
                                  controller: _searchCtrl,
                                  autofocus: true,
                                  decoration: const InputDecoration(
                                    hintText: 'Поиск проектов…',
                                  ),
                                  onChanged: (v) =>
                                      setState(() => _query = v.trim()),
                                )
                              : Text(
                                  'Привет, ${state.me?.name ?? ''}!\nПроекты BaiTech',
                                  style: const TextStyle(
                                    fontSize: 24,
                                    fontWeight: FontWeight.w800,
                                    height: 1.25,
                                  ),
                                ),
                        ),
                        const SizedBox(width: 12),
                        GradientIconButton(
                          icon: _searchOpen
                              ? Icons.close_rounded
                              : Icons.search_rounded,
                          onTap: () => setState(() {
                            _searchOpen = !_searchOpen;
                            if (!_searchOpen) {
                              _query = '';
                              _searchCtrl.clear();
                            }
                          }),
                        ),
                        const SizedBox(width: 10),
                        GradientIconButton(
                          icon: Icons.add_rounded,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                                builder: (_) => const ProjectFormScreen()),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    _SummaryBanner(state: state),
                    const SizedBox(height: 18),
                    _StatusTabs(
                      current: _statusFilter,
                      counts: {
                        null: state.projects.length,
                        for (final s in ProjectStatus.values)
                          s: state.countByStatus(s),
                      },
                      onChanged: (s) => setState(() => _statusFilter = s),
                    ),
                    const SizedBox(height: 12),
                    _AssigneeFilter(
                      state: state,
                      current: _assigneeFilter,
                      onChanged: (id) => setState(() => _assigneeFilter = id),
                    ),
                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ),
            if (projects.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.only(top: 60),
                  child: Column(
                    children: [
                      Icon(Icons.folder_open_rounded,
                          size: 56,
                          color:
                              AppColors.textSecondary.withValues(alpha: 0.5)),
                      const SizedBox(height: 12),
                      const Text(
                        'Пока пусто.\nНажми «+», чтобы создать проект.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                sliver: SliverList.separated(
                  itemCount: projects.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (_, i) => ProjectCard(
                    project: projects[i],
                    autofocus: i == 0,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Верхний баннер-сводка (место баннера «30% Off» из референса).
class _SummaryBanner extends StatelessWidget {
  final AppState state;
  const _SummaryBanner({required this.state});

  @override
  Widget build(BuildContext context) {
    final overdue = state.projects
        .where((p) =>
            p.status != ProjectStatus.done &&
            p.daysLeft != null &&
            p.daysLeft! < 0)
        .length;
    final inProgress = state.countByStatus(ProjectStatus.inProgress);
    final done = state.countByStatus(ProjectStatus.done);

    return DarkCard(
      padding: const EdgeInsets.all(20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _stat('$inProgress', 'в работе', AppColors.cyan),
          _divider(),
          _stat('$done', 'готово', AppColors.green),
          _divider(),
          _stat('$overdue', 'просрочено',
              overdue > 0 ? AppColors.red : AppColors.textSecondary),
        ],
      ),
    );
  }

  Widget _divider() => Container(
        width: 1,
        height: 36,
        color: Colors.white.withValues(alpha: 0.08),
      );

  Widget _stat(String value, String label, Color color) => Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          Text(
            label,
            style:
                const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ],
      );
}

class _StatusTabs extends StatelessWidget {
  final ProjectStatus? current;
  final Map<ProjectStatus?, int> counts;
  final ValueChanged<ProjectStatus?> onChanged;

  const _StatusTabs({
    required this.current,
    required this.counts,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final entries = <(ProjectStatus?, String)>[
      (null, 'Все'),
      (ProjectStatus.todo, 'Новые'),
      (ProjectStatus.inProgress, 'В работе'),
      (ProjectStatus.done, 'Готово'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: entries.map((e) {
          final active = current == e.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 10),
            child: FocusableTap(
              onTap: () => onChanged(e.$1),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  gradient: active ? AppColors.accentGradient : null,
                  color: active ? null : AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: active
                      ? [
                          BoxShadow(
                            color: AppColors.indigo.withValues(alpha: 0.4),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ]
                      : null,
                ),
                child: Text(
                  '${e.$2} · ${counts[e.$1] ?? 0}',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: active ? Colors.white : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _AssigneeFilter extends StatelessWidget {
  final AppState state;
  final String? current;
  final ValueChanged<String?> onChanged;

  const _AssigneeFilter({
    required this.state,
    required this.current,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (state.developers.isEmpty) return const SizedBox.shrink();
    return Row(
      children: [
        const Text(
          'Исполнитель:',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
        ),
        const SizedBox(width: 10),
        ...state.developers.map((dev) {
          final active = current == dev.id;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FocusableTap(
              onTap: () => onChanged(active ? null : dev.id),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: active
                      ? dev.avatarColor.withValues(alpha: 0.2)
                      : AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: active ? dev.avatarColor : Colors.transparent,
                  ),
                ),
                child: Text(
                  dev.name,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: active ? dev.avatarColor : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          );
        }),
      ],
    );
  }
}
