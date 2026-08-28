import 'dart:convert';
import 'dart:typed_data';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/models.dart';

/// Доступ к данным: Supabase + локальный кэш (offline-first чтение).
class Repo {
  SupabaseClient get _db => Supabase.instance.client;

  static const _cacheProjects = 'cache_projects_v1';
  static const _cacheMembers = 'cache_members_v1';

  // ---------- Члены команды ----------

  Future<List<Member>> fetchMembers() async {
    final rows = await _db.from('bt_members').select().order('created_at');
    final list = (rows as List)
        .map((r) => Member.fromJson(r as Map<String, dynamic>))
        .toList();
    _saveCache(_cacheMembers, rows);
    return list;
  }

  Future<List<Member>?> cachedMembers() async {
    final raw = await _readCache(_cacheMembers);
    if (raw == null) return null;
    return raw.map((r) => Member.fromJson(r)).toList();
  }

  Future<void> updateMemberPhone(String memberId, String phone) async {
    await _db.from('bt_members').update({'phone': phone}).eq('id', memberId);
  }

  // ---------- Проекты ----------

  Future<List<Project>> fetchProjects() async {
    final rows = await _db
        .from('bt_projects')
        .select()
        .order('created_at', ascending: false);
    final list = (rows as List)
        .map((r) => Project.fromJson(r as Map<String, dynamic>))
        .toList();
    _saveCache(_cacheProjects, rows);
    return list;
  }

  Future<List<Project>?> cachedProjects() async {
    final raw = await _readCache(_cacheProjects);
    if (raw == null) return null;
    return raw.map((r) => Project.fromJson(r)).toList();
  }

  Future<Project> createProject({
    required String title,
    String? description,
    String? assigneeId,
    DateTime? deadline,
    String? githubUrl,
    required Member actor,
  }) async {
    final row = await _db
        .from('bt_projects')
        .insert({
          'title': title,
          'description': description,
          'assignee_id': assigneeId,
          'deadline': deadline?.toUtc().toIso8601String(),
          'github_url': githubUrl,
          'created_by': actor.id,
        })
        .select()
        .single();
    final project = Project.fromJson(row);
    await logActivity(project.id, actor, 'создал(а) проект');
    return project;
  }

  Future<void> updateProject(
    String id,
    Map<String, dynamic> patch,
  ) async {
    await _db.from('bt_projects').update(patch).eq('id', id);
  }

  Future<void> setStatus(Project p, ProjectStatus status, Member actor) async {
    await updateProject(p.id, {'status': status.db});
    await logActivity(
      p.id,
      actor,
      'перевёл(а) в статус «${status.label}»',
    );
  }

  Future<void> deleteProject(String id) async {
    await _db.from('bt_projects').delete().eq('id', id);
  }

  // ---------- Фото ----------

  Future<List<ProjectPhoto>> fetchPhotos(String projectId) async {
    final rows = await _db
        .from('bt_photos')
        .select()
        .eq('project_id', projectId)
        .order('created_at');
    return (rows as List)
        .map((r) => ProjectPhoto.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<ProjectPhoto> uploadPhoto({
    required String projectId,
    required Uint8List bytes,
    required String filename,
    required Member actor,
  }) async {
    final path =
        '$projectId/${DateTime.now().millisecondsSinceEpoch}_$filename';
    await _db.storage.from('bt-photos').uploadBinary(
          path,
          bytes,
          fileOptions: const FileOptions(upsert: true),
        );
    final url = _db.storage.from('bt-photos').getPublicUrl(path);
    final row = await _db
        .from('bt_photos')
        .insert({'project_id': projectId, 'url': url})
        .select()
        .single();
    // первое фото становится обложкой
    final photos = await fetchPhotos(projectId);
    if (photos.length == 1) {
      await updateProject(projectId, {'cover_url': url});
    }
    await logActivity(projectId, actor, 'добавил(а) фото');
    return ProjectPhoto.fromJson(row);
  }

  // ---------- Комментарии ----------

  Future<List<Comment>> fetchComments(String projectId) async {
    final rows = await _db
        .from('bt_comments')
        .select()
        .eq('project_id', projectId)
        .order('created_at');
    return (rows as List)
        .map((r) => Comment.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<Comment> addComment(
    String projectId,
    Member author,
    String body,
  ) async {
    final row = await _db
        .from('bt_comments')
        .insert({
          'project_id': projectId,
          'author_id': author.id,
          'body': body,
        })
        .select()
        .single();
    return Comment.fromJson(row);
  }

  // ---------- Лента активности ----------

  Future<List<ActivityEntry>> fetchActivity(String projectId) async {
    final rows = await _db
        .from('bt_activity')
        .select()
        .eq('project_id', projectId)
        .order('created_at', ascending: false);
    return (rows as List)
        .map((r) => ActivityEntry.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<void> logActivity(
    String projectId,
    Member actor,
    String action, {
    String? detail,
  }) async {
    await _db.from('bt_activity').insert({
      'project_id': projectId,
      'actor_id': actor.id,
      'action': action,
      'detail': detail,
    });
  }

  // ---------- Расходы ----------

  static const _cacheExpenses = 'cache_expenses_v1';

  Future<List<Expense>> fetchExpenses() async {
    final rows =
        await _db.from('bt_expenses').select().order('paid_at', ascending: false);
    _saveCache(_cacheExpenses, rows);
    return (rows as List)
        .map((r) => Expense.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<List<Expense>?> cachedExpenses() async {
    final raw = await _readCache(_cacheExpenses);
    if (raw == null) return null;
    return raw.map((r) => Expense.fromJson(r)).toList();
  }

  Future<void> addExpense({
    required String title,
    required ExpenseCategory category,
    required double amount,
    required String currency,
    required DateTime paidAt,
    DateTime? nextDue,
    Uint8List? receiptBytes,
    String? receiptName,
    String? note,
    required Member actor,
  }) async {
    String? url;
    if (receiptBytes != null && receiptName != null) {
      final path =
          '${DateTime.now().millisecondsSinceEpoch}_$receiptName';
      await _db.storage.from('bt-receipts').uploadBinary(
            path,
            receiptBytes,
            fileOptions: const FileOptions(upsert: true),
          );
      url = _db.storage.from('bt-receipts').getPublicUrl(path);
    }
    await _db.from('bt_expenses').insert({
      'title': title,
      'category': category.db,
      'amount': amount,
      'currency': currency,
      'paid_at': paidAt.toIso8601String().substring(0, 10),
      'next_due': nextDue?.toIso8601String().substring(0, 10),
      'receipt_url': url,
      'receipt_name': receiptName,
      'note': note,
      'created_by': actor.id,
    });
  }

  Future<void> deleteExpense(String id) async {
    await _db.from('bt_expenses').delete().eq('id', id);
  }

  // ---------- Кэш ----------

  Future<void> _saveCache(String key, dynamic rows) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, jsonEncode(rows));
    } catch (_) {/* кэш не критичен */}
  }

  Future<List<Map<String, dynamic>>?> _readCache(String key) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(key);
      if (raw == null) return null;
      return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    } catch (_) {
      return null;
    }
  }
}
