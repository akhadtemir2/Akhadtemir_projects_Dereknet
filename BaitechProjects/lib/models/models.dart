import 'package:flutter/material.dart';

enum ProjectStatus {
  todo('todo', 'Новый', Icons.inbox_rounded),
  inProgress('in_progress', 'В работе', Icons.bolt_rounded),
  done('done', 'Готово', Icons.check_circle_rounded);

  const ProjectStatus(this.db, this.label, this.icon);
  final String db;
  final String label;
  final IconData icon;

  static ProjectStatus fromDb(String v) =>
      values.firstWhere((s) => s.db == v, orElse: () => todo);
}

class Member {
  final String id;
  final String name;
  final String role; // boss | developer
  final String? phone;
  final Color avatarColor;

  Member({
    required this.id,
    required this.name,
    required this.role,
    this.phone,
    required this.avatarColor,
  });

  bool get isBoss => role == 'boss';

  factory Member.fromJson(Map<String, dynamic> j) => Member(
        id: j['id'] as String,
        name: j['name'] as String,
        role: j['role'] as String,
        phone: j['phone'] as String?,
        avatarColor: _parseColor(j['avatar_color'] as String?),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role,
        'phone': phone,
        'avatar_color':
            '#${avatarColor.toARGB32().toRadixString(16).substring(2).toUpperCase()}',
      };

  static Color _parseColor(String? hex) {
    if (hex == null || hex.isEmpty) return const Color(0xFF37B6E9);
    final v = hex.replaceFirst('#', '');
    return Color(int.parse('FF$v', radix: 16));
  }
}

class Project {
  final String id;
  final String title;
  final String? description;
  final ProjectStatus status;
  final String? assigneeId;
  final String? createdBy;
  final DateTime? deadline;
  final String? coverUrl;
  final String? githubUrl;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;

  Project({
    required this.id,
    required this.title,
    this.description,
    required this.status,
    this.assigneeId,
    this.createdBy,
    this.deadline,
    this.coverUrl,
    this.githubUrl,
    required this.createdAt,
    required this.updatedAt,
    this.completedAt,
  });

  factory Project.fromJson(Map<String, dynamic> j) => Project(
        id: j['id'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        status: ProjectStatus.fromDb(j['status'] as String),
        assigneeId: j['assignee_id'] as String?,
        createdBy: j['created_by'] as String?,
        deadline: _date(j['deadline']),
        coverUrl: j['cover_url'] as String?,
        githubUrl: j['github_url'] as String?,
        createdAt: _date(j['created_at'])!,
        updatedAt: _date(j['updated_at'])!,
        completedAt: _date(j['completed_at']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'status': status.db,
        'assignee_id': assigneeId,
        'created_by': createdBy,
        'deadline': deadline?.toIso8601String(),
        'cover_url': coverUrl,
        'github_url': githubUrl,
        'created_at': createdAt.toIso8601String(),
        'updated_at': updatedAt.toIso8601String(),
        'completed_at': completedAt?.toIso8601String(),
      };

  static DateTime? _date(dynamic v) =>
      v == null ? null : DateTime.parse(v as String).toLocal();

  /// Дней до дедлайна (отрицательное — просрочен).
  int? get daysLeft {
    if (deadline == null) return null;
    final today = DateTime.now();
    final d0 = DateTime(today.year, today.month, today.day);
    final d1 = DateTime(deadline!.year, deadline!.month, deadline!.day);
    return d1.difference(d0).inDays;
  }
}

class ProjectPhoto {
  final String id;
  final String projectId;
  final String url;

  ProjectPhoto({required this.id, required this.projectId, required this.url});

  factory ProjectPhoto.fromJson(Map<String, dynamic> j) => ProjectPhoto(
        id: j['id'] as String,
        projectId: j['project_id'] as String,
        url: j['url'] as String,
      );
}

class Comment {
  final String id;
  final String projectId;
  final String? authorId;
  final String body;
  final DateTime createdAt;

  Comment({
    required this.id,
    required this.projectId,
    this.authorId,
    required this.body,
    required this.createdAt,
  });

  factory Comment.fromJson(Map<String, dynamic> j) => Comment(
        id: j['id'] as String,
        projectId: j['project_id'] as String,
        authorId: j['author_id'] as String?,
        body: j['body'] as String,
        createdAt: DateTime.parse(j['created_at'] as String).toLocal(),
      );
}

enum ExpenseCategory {
  openai('openai', 'OpenAI', Icons.auto_awesome_rounded),
  hosting('hosting', 'Хостинг', Icons.dns_rounded),
  other('other', 'Другое', Icons.receipt_long_rounded);

  const ExpenseCategory(this.db, this.label, this.icon);
  final String db;
  final String label;
  final IconData icon;

  static ExpenseCategory fromDb(String v) =>
      values.firstWhere((c) => c.db == v, orElse: () => other);
}

class Expense {
  final String id;
  final String title;
  final ExpenseCategory category;
  final double amount;
  final String currency;
  final DateTime paidAt;
  final DateTime? nextDue;
  final String? receiptUrl;
  final String? receiptName;
  final String? note;
  final String? createdBy;

  Expense({
    required this.id,
    required this.title,
    required this.category,
    required this.amount,
    required this.currency,
    required this.paidAt,
    this.nextDue,
    this.receiptUrl,
    this.receiptName,
    this.note,
    this.createdBy,
  });

  factory Expense.fromJson(Map<String, dynamic> j) => Expense(
        id: j['id'] as String,
        title: j['title'] as String,
        category: ExpenseCategory.fromDb(j['category'] as String),
        amount: (j['amount'] as num).toDouble(),
        currency: j['currency'] as String? ?? 'USD',
        paidAt: DateTime.parse(j['paid_at'] as String),
        nextDue: j['next_due'] == null
            ? null
            : DateTime.parse(j['next_due'] as String),
        receiptUrl: j['receipt_url'] as String?,
        receiptName: j['receipt_name'] as String?,
        note: j['note'] as String?,
        createdBy: j['created_by'] as String?,
      );

  /// Дней до следующей оплаты (отрицательное — просрочена).
  int? get daysToDue {
    if (nextDue == null) return null;
    final today = DateTime.now();
    final d0 = DateTime(today.year, today.month, today.day);
    return DateTime(nextDue!.year, nextDue!.month, nextDue!.day)
        .difference(d0)
        .inDays;
  }
}

class ActivityEntry {
  final String id;
  final String projectId;
  final String? actorId;
  final String action;
  final String? detail;
  final DateTime createdAt;

  ActivityEntry({
    required this.id,
    required this.projectId,
    this.actorId,
    required this.action,
    this.detail,
    required this.createdAt,
  });

  factory ActivityEntry.fromJson(Map<String, dynamic> j) => ActivityEntry(
        id: j['id'] as String,
        projectId: j['project_id'] as String,
        actorId: j['actor_id'] as String?,
        action: j['action'] as String,
        detail: j['detail'] as String?,
        createdAt: DateTime.parse(j['created_at'] as String).toLocal(),
      );
}
