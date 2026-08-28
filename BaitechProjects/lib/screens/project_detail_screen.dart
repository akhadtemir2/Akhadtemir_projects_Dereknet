import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';
import 'project_form_screen.dart';

/// Детальная карточка проекта: фото, описание, активность, комментарии.
class ProjectDetailScreen extends StatefulWidget {
  final String projectId;
  const ProjectDetailScreen({super.key, required this.projectId});

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _photosCtrl = PageController();
  final _commentCtrl = TextEditingController();

  List<ProjectPhoto> _photos = [];
  List<Comment> _comments = [];
  List<ActivityEntry> _activity = [];
  int _photoIndex = 0;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _photosCtrl.dispose();
    _commentCtrl.dispose();
    super.dispose();
  }

  Project? get _project {
    final state = context.read<AppState>();
    for (final p in state.projects) {
      if (p.id == widget.projectId) return p;
    }
    return null;
  }

  Future<void> _load() async {
    final repo = context.read<AppState>().repo;
    try {
      final results = await Future.wait([
        repo.fetchPhotos(widget.projectId),
        repo.fetchComments(widget.projectId),
        repo.fetchActivity(widget.projectId),
      ]);
      if (!mounted) return;
      setState(() {
        _photos = results[0] as List<ProjectPhoto>;
        _comments = results[1] as List<Comment>;
        _activity = results[2] as List<ActivityEntry>;
      });
    } catch (_) {/* оффлайн — покажем что есть */}
  }

  Future<void> _addPhoto() async {
    final state = context.read<AppState>();
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 85,
    );
    if (file == null) return;
    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      await state.repo.uploadPhoto(
        projectId: widget.projectId,
        bytes: bytes,
        filename: file.name,
        actor: state.me!,
      );
      await state.refresh();
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Не удалось загрузить фото: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendComment() async {
    final text = _commentCtrl.text.trim();
    if (text.isEmpty) return;
    final state = context.read<AppState>();
    _commentCtrl.clear();
    await state.repo.addComment(widget.projectId, state.me!, text);
    await state.repo
        .logActivity(widget.projectId, state.me!, 'оставил(а) комментарий');
    await _load();
  }

  Future<void> _changeStatus(ProjectStatus s) async {
    final p = _project;
    if (p == null || p.status == s) return;
    setState(() => _busy = true);
    await context.read<AppState>().setStatus(p, s);
    await _load();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final p = state.projects
        .where((x) => x.id == widget.projectId)
        .cast<Project?>()
        .firstOrNull;
    if (p == null) {
      return const Scaffold(body: Center(child: Text('Проект удалён')));
    }
    final assignee = state.memberById(p.assigneeId);

    return Scaffold(
      appBar: AppBar(
        title: Text(p.title.toUpperCase(),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 6, bottom: 6),
          child: GradientIconButton(
            icon: Icons.arrow_back_ios_new_rounded,
            size: 42,
            onTap: () => Navigator.pop(context),
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_rounded),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => ProjectFormScreen(existing: p),
              ),
            ),
          ),
          if (state.me?.isBoss == true)
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded,
                  color: AppColors.red),
              onPressed: () => _confirmDelete(p),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 16),
              children: [
                _photoCarousel(p),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          StatusChip(status: p.status),
                          const SizedBox(width: 8),
                          DeadlineBadge(project: p),
                          const Spacer(),
                          if (assignee != null)
                            FocusableTap(
                              onTap: () => MemberAvatar.call(context, assignee),
                              child: Row(
                                children: [
                                  MemberAvatar(member: assignee, radius: 15),
                                  const SizedBox(width: 6),
                                  Text(
                                    assignee.name,
                                    style: TextStyle(
                                      color: assignee.avatarColor,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  const Icon(Icons.call_rounded,
                                      size: 16, color: AppColors.green),
                                ],
                              ),
                            ),
                        ],
                      ),
                      if (p.deadline != null) ...[
                        const SizedBox(height: 10),
                        Text(
                          'Дедлайн: ${DateFormat('d MMMM yyyy', 'ru').format(p.deadline!)}',
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13),
                        ),
                      ],
                      const SizedBox(height: 16),
                      _statusButtons(p),
                      const SizedBox(height: 20),
                      _tabBar(),
                      const SizedBox(height: 16),
                      SizedBox(
                        height: 320,
                        child: TabBarView(
                          controller: _tabs,
                          children: [
                            _descriptionTab(p),
                            _activityTab(state),
                            _commentsTab(state),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_tabIndexIsComments)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _commentCtrl,
                        decoration: const InputDecoration(
                          hintText: 'Комментарий, ссылка, вопрос по ТЗ…',
                        ),
                        onSubmitted: (_) => _sendComment(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    GradientIconButton(
                      icon: Icons.send_rounded,
                      size: 48,
                      onTap: _sendComment,
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  bool get _tabIndexIsComments => _tabs.index == 2;

  Widget _photoCarousel(Project p) {
    return SizedBox(
      height: 240,
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(painter: _DetailWedgePainter()),
          ),
          if (_photos.isEmpty)
            Center(
              child: ShaderMask(
                shaderCallback: (b) => AppColors.accentGradient.createShader(b),
                child: const Icon(Icons.rocket_launch_rounded,
                    size: 90, color: Colors.white),
              ),
            )
          else
            PageView.builder(
              controller: _photosCtrl,
              itemCount: _photos.length,
              onPageChanged: (i) => setState(() => _photoIndex = i),
              itemBuilder: (_, i) => Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: Image.network(_photos[i].url, fit: BoxFit.cover),
                ),
              ),
            ),
          Positioned(
            bottom: 8,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < _photos.length; i++)
                  Container(
                    width: i == _photoIndex ? 8 : 6,
                    height: i == _photoIndex ? 8 : 6,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == _photoIndex
                          ? AppColors.cyan
                          : AppColors.textSecondary.withValues(alpha: 0.4),
                    ),
                  ),
              ],
            ),
          ),
          Positioned(
            right: 16,
            bottom: 16,
            child: GradientIconButton(
              icon: _busy
                  ? Icons.hourglass_top_rounded
                  : Icons.add_a_photo_rounded,
              size: 44,
              onTap: _busy ? null : _addPhoto,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusButtons(Project p) {
    return Row(
      children: ProjectStatus.values.map((s) {
        final active = p.status == s;
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FocusableTap(
              onTap: _busy ? null : () => _changeStatus(s),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  gradient: active ? AppColors.accentGradient : null,
                  color: active ? null : AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  children: [
                    Icon(s.icon,
                        size: 20,
                        color: active ? Colors.white : AppColors.textSecondary),
                    const SizedBox(height: 4),
                    Text(
                      s.label,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: active ? Colors.white : AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _tabBar() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bgDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: TabBar(
        controller: _tabs,
        onTap: (_) => setState(() {}),
        indicator: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.cyan.withValues(alpha: 0.4)),
        ),
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: Colors.transparent,
        labelColor: AppColors.cyan,
        unselectedLabelColor: AppColors.textSecondary,
        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        tabs: const [
          Tab(text: 'Описание'),
          Tab(text: 'История'),
          Tab(text: 'Чат'),
        ],
      ),
    );
  }

  Widget _descriptionTab(Project p) {
    final state = context.read<AppState>();
    final creator = state.memberById(p.createdBy);
    return ListView(
      padding: EdgeInsets.zero,
      children: [
        Text(
          p.title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text(
          (p.description ?? '').isEmpty ? 'Без описания.' : p.description!,
          style: const TextStyle(
            color: AppColors.textSecondary,
            height: 1.5,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 16),
        if ((p.githubUrl ?? '').isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: GradientButton(
              label: 'Открыть репозиторий',
              icon: Icons.code_rounded,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              onTap: () => launchUrl(Uri.parse(p.githubUrl!),
                  mode: LaunchMode.externalApplication),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          'Создан: ${DateFormat('d MMM yyyy, HH:mm', 'ru').format(p.createdAt)}'
          '${creator != null ? ' · ${creator.name}' : ''}',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
        if (p.completedAt != null)
          Text(
            'Завершён: ${DateFormat('d MMM yyyy, HH:mm', 'ru').format(p.completedAt!)}',
            style: const TextStyle(color: AppColors.green, fontSize: 12),
          ),
      ],
    );
  }

  Widget _activityTab(AppState state) {
    if (_activity.isEmpty) {
      return const Center(
        child: Text('История пуста',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }
    return ListView.builder(
      padding: EdgeInsets.zero,
      itemCount: _activity.length,
      itemBuilder: (_, i) {
        final a = _activity[i];
        final actor = state.memberById(a.actorId);
        return Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsets.only(top: 4),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: actor?.avatarColor ?? AppColors.cyan,
                    ),
                  ),
                  if (i != _activity.length - 1)
                    Container(
                      width: 2,
                      height: 30,
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: '${actor?.name ?? 'Кто-то'} ',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              color: actor?.avatarColor ?? AppColors.cyan,
                            ),
                          ),
                          TextSpan(text: a.action),
                        ],
                      ),
                      style: const TextStyle(fontSize: 13.5),
                    ),
                    Text(
                      DateFormat('d MMM, HH:mm', 'ru').format(a.createdAt),
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _commentsTab(AppState state) {
    if (_comments.isEmpty) {
      return const Center(
        child: Text('Комментариев нет — напиши первый',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }
    return ListView.builder(
      padding: EdgeInsets.zero,
      itemCount: _comments.length,
      itemBuilder: (_, i) {
        final c = _comments[i];
        final author = state.memberById(c.authorId);
        final mine = c.authorId == state.me?.id;
        return Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            constraints: const BoxConstraints(maxWidth: 280),
            decoration: BoxDecoration(
              gradient: mine ? AppColors.accentGradient : null,
              color: mine ? null : AppColors.surface,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(16),
                topRight: const Radius.circular(16),
                bottomLeft: Radius.circular(mine ? 16 : 4),
                bottomRight: Radius.circular(mine ? 4 : 16),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!mine)
                  Text(
                    author?.name ?? '?',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: author?.avatarColor ?? AppColors.cyan,
                    ),
                  ),
                Text(c.body, style: const TextStyle(fontSize: 14)),
                const SizedBox(height: 4),
                Text(
                  DateFormat('d MMM, HH:mm', 'ru').format(c.createdAt),
                  style: TextStyle(
                    fontSize: 10,
                    color: mine ? Colors.white70 : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmDelete(Project p) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить проект?'),
        content: Text('«${p.title}» будет удалён навсегда.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child:
                const Text('Удалить', style: TextStyle(color: AppColors.red)),
          ),
        ],
      ),
    );
    if (yes == true && mounted) {
      await context.read<AppState>().deleteProject(p);
      if (mounted) Navigator.pop(context);
    }
  }
}

class _DetailWedgePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width, 0)
      ..lineTo(size.width, size.height)
      ..lineTo(size.width * 0.35, size.height)
      ..close();
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
        colors: [Color(0x664B4CED), Color(0x2237B6E9)],
      ).createShader(Offset.zero & size);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
