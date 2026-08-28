import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/models.dart';
import '../services/repo.dart';

/// Глобальное состояние: текущий пользователь, команда, проекты.
class AppState extends ChangeNotifier {
  final Repo repo = Repo();

  Member? me;
  List<Member> members = [];
  List<Project> projects = [];
  List<Expense> expenses = [];
  bool loading = true;
  bool offline = false;

  static const _prefMe = 'current_member_id';
  static const _prefVoice = 'jarvis_voice_enabled';

  /// Включён ли голос Чарльза (озвучка ответов + приветствие).
  bool voiceEnabled = true;

  Member? memberById(String? id) {
    if (id == null) return null;
    for (final m in members) {
      if (m.id == id) return m;
    }
    return null;
  }

  List<Member> get developers =>
      members.where((m) => m.role == 'developer').toList();

  Future<void> init() async {
    loading = true;
    notifyListeners();
    // сперва мгновенно показываем кэш, потом обновляем из сети
    final cachedM = await repo.cachedMembers();
    final cachedP = await repo.cachedProjects();
    final cachedE = await repo.cachedExpenses();
    if (cachedM != null) members = cachedM;
    if (cachedP != null) projects = cachedP;
    if (cachedE != null) expenses = cachedE;
    if (members.isNotEmpty) {
      await _restoreMe();
      loading = false;
      notifyListeners();
    }
    final prefs = await SharedPreferences.getInstance();
    voiceEnabled = prefs.getBool(_prefVoice) ?? true;
    loadExchangeRate(); // в фоне, не блокирует запуск
    await refresh();
  }

  Future<void> setVoiceEnabled(bool v) async {
    voiceEnabled = v;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefVoice, v);
    notifyListeners();
  }

  Future<void> refresh() async {
    try {
      final results = await Future.wait([
        repo.fetchMembers(),
        repo.fetchProjects(),
        repo.fetchExpenses(),
      ]);
      members = results[0] as List<Member>;
      projects = results[1] as List<Project>;
      expenses = results[2] as List<Expense>;
      offline = false;
      await _restoreMe();
    } catch (_) {
      offline = true; // работаем на кэше
    }
    loading = false;
    notifyListeners();
  }

  Future<void> _restoreMe() async {
    if (me != null) {
      me = memberById(me!.id) ?? me;
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString(_prefMe);
    if (id != null) me = memberById(id);
  }

  Future<void> selectMember(Member m) async {
    me = m;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefMe, m.id);
    notifyListeners();
  }

  Future<void> logout() async {
    me = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefMe);
    notifyListeners();
  }

  // ---------- Действия над проектами ----------

  Future<Project> createProject({
    required String title,
    String? description,
    String? assigneeId,
    DateTime? deadline,
    String? githubUrl,
  }) async {
    final p = await repo.createProject(
      title: title,
      description: description,
      assigneeId: assigneeId,
      deadline: deadline,
      githubUrl: githubUrl,
      actor: me!,
    );
    projects = [p, ...projects];
    notifyListeners();
    await refresh();
    return p;
  }

  Future<void> setStatus(Project p, ProjectStatus s) async {
    await repo.setStatus(p, s, me!);
    await refresh();
  }

  Future<void> updateProject(Project p, Map<String, dynamic> patch,
      {String? activity}) async {
    await repo.updateProject(p.id, patch);
    if (activity != null) {
      await repo.logActivity(p.id, me!, activity);
    }
    await refresh();
  }

  Future<void> deleteProject(Project p) async {
    await repo.deleteProject(p.id);
    projects.removeWhere((x) => x.id == p.id);
    notifyListeners();
  }

  Future<void> setMemberPhone(Member m, String phone) async {
    await repo.updateMemberPhone(m.id, phone);
    await refresh();
  }

  // ---------- Расходы ----------

  /// Курс доллара к тенге. Обновляется из сети, кэшируется.
  double usdKzt = 540;
  static const _prefRate = 'usd_kzt_rate';

  Future<void> loadExchangeRate() async {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getDouble(_prefRate);
    if (cached != null && cached > 0) usdKzt = cached;
    try {
      final res = await http
          .get(Uri.parse('https://open.er-api.com/v6/latest/USD'))
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final rate =
            ((jsonDecode(res.body)['rates']?['KZT']) as num?)?.toDouble();
        if (rate != null && rate > 0) {
          usdKzt = rate;
          await prefs.setDouble(_prefRate, rate);
          notifyListeners();
        }
      }
    } catch (_) {/* остаёмся на кэшированном/дефолтном курсе */}
  }

  /// Сумма расходов за последние [months] месяцев в валюте [currency].
  double expensesTotal({required int months, required String currency}) {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month - (months - 1), 1);
    return expenses
        .where((e) => e.currency == currency && !e.paidAt.isBefore(from))
        .fold(0.0, (sum, e) => sum + e.amount);
  }

  /// Общий итог (доллары + тенге) в пересчёте на доллары.
  double combinedUsd(int months) =>
      expensesTotal(months: months, currency: 'USD') +
      expensesTotal(months: months, currency: 'KZT') / usdKzt;

  /// Общий итог (доллары + тенге) в пересчёте на тенге.
  double combinedKzt(int months) =>
      expensesTotal(months: months, currency: 'KZT') +
      expensesTotal(months: months, currency: 'USD') * usdKzt;

  /// Сумма расходов за [months] месяцев по категории [category] в валюте [currency].
  double categoryTotal({
    required int months,
    required ExpenseCategory category,
    required String currency,
  }) {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month - (months - 1), 1);
    return expenses
        .where((e) =>
            e.category == category &&
            e.currency == currency &&
            !e.paidAt.isBefore(from))
        .fold(0.0, (sum, e) => sum + e.amount);
  }

  /// Итог по категории (доллары + тенге) в пересчёте на доллары —
  /// нужен для распределения расходов по категориям.
  double categoryCombinedUsd(int months, ExpenseCategory category) =>
      categoryTotal(months: months, category: category, currency: 'USD') +
      categoryTotal(months: months, category: category, currency: 'KZT') /
          usdKzt;

  /// Ближайшие оплаты (у кого задана дата следующего платежа).
  List<Expense> get upcomingPayments {
    final list = expenses.where((e) => e.nextDue != null).toList()
      ..sort((a, b) => a.nextDue!.compareTo(b.nextDue!));
    // одна запись на подписку — самая свежая по названию
    final seen = <String>{};
    return list
        .where((e) => seen.add(e.title.toLowerCase().trim()))
        .toList();
  }

  /// Сумма пополнений OpenAI в долларах (для расчёта остатка кредитов).
  double get openAiTopUps => expenses
      .where((e) =>
          e.category == ExpenseCategory.openai && e.currency == 'USD')
      .fold(0.0, (sum, e) => sum + e.amount);

  /// Дата первого пополнения OpenAI.
  DateTime? get firstOpenAiTopUp {
    final list = expenses
        .where((e) => e.category == ExpenseCategory.openai)
        .map((e) => e.paidAt)
        .toList()
      ..sort();
    return list.isEmpty ? null : list.first;
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
  }) async {
    await repo.addExpense(
      title: title,
      category: category,
      amount: amount,
      currency: currency,
      paidAt: paidAt,
      nextDue: nextDue,
      receiptBytes: receiptBytes,
      receiptName: receiptName,
      note: note,
      actor: me!,
    );
    await refresh();
  }

  Future<void> deleteExpense(Expense e) async {
    await repo.deleteExpense(e.id);
    expenses.removeWhere((x) => x.id == e.id);
    notifyListeners();
  }

  // ---------- Статистика ----------

  int countByStatus(ProjectStatus s) =>
      projects.where((p) => p.status == s).length;

  int doneInMonth(DateTime month) => projects
      .where((p) =>
          p.status == ProjectStatus.done &&
          p.completedAt != null &&
          p.completedAt!.year == month.year &&
          p.completedAt!.month == month.month)
      .length;

  Map<Member, int> openByDeveloper() {
    final map = <Member, int>{};
    for (final dev in developers) {
      map[dev] = projects
          .where((p) =>
              p.assigneeId == dev.id && p.status != ProjectStatus.done)
          .length;
    }
    return map;
  }

  Map<Member, int> doneByDeveloper() {
    final map = <Member, int>{};
    for (final dev in developers) {
      map[dev] = projects
          .where(
              (p) => p.assigneeId == dev.id && p.status == ProjectStatus.done)
          .length;
    }
    return map;
  }
}
