import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/openai_billing_service.dart';
import '../state/app_state.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

String _money(double v) =>
    '\$${v.toStringAsFixed(v == v.roundToDouble() ? 0 : 2)}';

final _kztFmt = NumberFormat('#,##0', 'ru');
String _kzt(double v) => '₸${_kztFmt.format(v)}';

/// Сумма в своей валюте: $5 или ₸2 500.
String _amount(double v, String currency) =>
    currency == 'KZT' ? _kzt(v) : _money(v);

/// Расходы: итоги за месяц / 3 месяца / год, баланс OpenAI,
/// список платежей с чеками и датами следующей оплаты.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

const _kPeriods = [1, 3, 12];
const _kPeriodLabels = ['Месяц', '3 месяца', 'Год'];

class _ExpensesScreenState extends State<ExpensesScreen> {
  OpenAiUsage? _usage;
  String? _usageError;
  bool _usageLoading = false;
  int _periodIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadUsage());
  }

  Future<void> _loadUsage() async {
    if (!OpenAiBillingService.isConfigured) {
      setState(() => _usageError =
          'Добавь Admin-ключ OpenAI (sk-admin-…) при сборке — тогда баланс будет считаться сам');
      return;
    }
    final state = context.read<AppState>();
    setState(() {
      _usageLoading = true;
      _usageError = null;
    });
    try {
      final since = state.firstOpenAiTopUp ??
          DateTime(DateTime.now().year, DateTime.now().month, 1);
      final usage = await OpenAiBillingService.fetchUsage(since: since);
      if (mounted) setState(() => _usage = usage);
    } catch (e) {
      if (mounted) setState(() => _usageError = e.toString());
    } finally {
      if (mounted) setState(() => _usageLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.cyan,
        backgroundColor: AppColors.surface,
        onRefresh: () async {
          await context.read<AppState>().refresh();
          await _loadUsage();
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Расходы',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                  ),
                ),
                GradientIconButton(
                  icon: Icons.add_rounded,
                  onTap: () => _openAddSheet(context),
                ),
              ],
            ),
            const SizedBox(height: 18),
            _totalsCard(state),
            const SizedBox(height: 14),
            _openAiCard(state),
            const SizedBox(height: 14),
            if (state.upcomingPayments.isNotEmpty) ...[
              _upcomingCard(state),
              const SizedBox(height: 18),
            ],
            const Text(
              'История платежей',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            if (state.expenses.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 30),
                child: Text(
                  'Пока нет расходов.\nНажми «+», чтобы добавить первый платёж.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              )
            else
              ...state.expenses.map(
                (e) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _ExpenseCard(
                    expense: e,
                    onDelete: () => _confirmDelete(context, e),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // Итоги считаются автоматически: сегментированный переключатель периода
  // (месяц — факт, 3 месяца / год — прогноз ×3 / ×12) + разбивка по категориям.
  Widget _totalsCard(AppState state) {
    final multiplier = _kPeriods[_periodIndex];
    final isForecast = multiplier > 1;
    final usd = state.expensesTotal(months: 1, currency: 'USD') * multiplier;
    final kzt = state.expensesTotal(months: 1, currency: 'KZT') * multiplier;
    final combinedUsd = state.combinedUsd(1) * multiplier;
    final combinedKzt = state.combinedKzt(1) * multiplier;

    final byCategory = ExpenseCategory.values
        .map((c) => MapEntry(c, state.categoryCombinedUsd(1, c) * multiplier))
        .where((e) => e.value > 0.005)
        .toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final maxCategory = byCategory.isEmpty ? 1.0 : byCategory.first.value;

    return DarkCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PeriodSegmented(
            labels: _kPeriodLabels,
            current: _periodIndex,
            onChanged: (i) => setState(() => _periodIndex = i),
          ),
          const SizedBox(height: 18),
          // Подпись периода + маркер «факт / прогноз» вынесены НАД суммой,
          // чтобы сразу было ясно, что за число смотрит пользователь.
          Row(
            children: [
              Text(
                isForecast
                    ? 'Прогноз · ${_kPeriodLabels[_periodIndex].toLowerCase()}'
                    : 'Факт · этот месяц',
                style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3),
              ),
              const SizedBox(width: 8),
              if (isForecast)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.cyan.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '×$multiplier',
                    style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.cyan),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          // Основная сумма: доллары и тенге на отдельных строках, чтобы длинные
          // числа не сжимались и не наезжали на разделитель «·».
          Text(
            _money(combinedUsd),
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            _kzt(combinedKzt),
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary),
          ),
          const SizedBox(height: 10),
          Text(
            'из них ${_money(usd)} + ${_kzt(kzt)}',
            style:
                const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
          if (byCategory.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 14),
              child: Text(
                'Нет расходов за этот период',
                style:
                    TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
              ),
            )
          else ...[
            const SizedBox(height: 18),
            const Text(
              'По категориям',
              style: TextStyle(
                  fontSize: 11,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4),
            ),
            const SizedBox(height: 10),
            ...byCategory.map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _categoryBar(e.key, e.value, maxCategory),
                )),
          ],
        ],
      ),
    );
  }

  Widget _categoryBar(ExpenseCategory category, double value, double maxValue) {
    final color = _categoryColor(category);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(category.icon, size: 13, color: color),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                category.label,
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              '≈ ${_money(value)}',
              style: TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700, color: color),
            ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: (value / maxValue).clamp(0.0, 1.0),
            minHeight: 6,
            backgroundColor: AppColors.bgDark,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }

  Color _categoryColor(ExpenseCategory category) => switch (category) {
        ExpenseCategory.openai => AppColors.cyan,
        ExpenseCategory.hosting => AppColors.indigo,
        ExpenseCategory.other => AppColors.green,
      };

  Widget _openAiCard(AppState state) {
    final topUps = state.openAiTopUps;
    final spent = _usage?.spendSince;
    final left = (spent != null && topUps > 0) ? topUps - spent : null;

    return DarkCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              ShaderMask(
                shaderCallback: (b) => AppColors.accentGradient.createShader(b),
                child: const Icon(Icons.auto_awesome_rounded,
                    color: Colors.white, size: 22),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Баланс OpenAI',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
              if (_usageLoading)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppColors.cyan),
                )
              else
                FocusableTap(
                  onTap: _loadUsage,
                  child: const Icon(Icons.refresh_rounded,
                      size: 20, color: AppColors.textSecondary),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (_usage != null) ...[
            Row(
              children: [
                _usageStat(
                  'потрачено в этом месяце',
                  _money(_usage!.monthSpend),
                  AppColors.yellow,
                ),
                if (left != null)
                  _usageStat(
                    'осталось кредитов ≈',
                    _money(left < 0 ? 0 : left),
                    left < 5 ? AppColors.red : AppColors.green,
                  ),
              ],
            ),
            if (left != null && left < 5)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  '⚠ Кредиты заканчиваются — пора пополнить!',
                  style: TextStyle(color: AppColors.red, fontSize: 13),
                ),
              ),
          ] else if (_usageError != null)
            Text(
              _usageError!,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12.5, height: 1.4),
            ),
        ],
      ),
    );
  }

  Widget _usageStat(String label, String value, Color color) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: TextStyle(
                    fontSize: 22, fontWeight: FontWeight.w800, color: color)),
            Text(label,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textSecondary)),
          ],
        ),
      );

  Widget _upcomingCard(AppState state) {
    return DarkCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ближайшие оплаты',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          ...state.upcomingPayments.take(4).map((e) {
            final days = e.daysToDue!;
            final color = days < 0
                ? AppColors.red
                : days <= 3
                    ? AppColors.yellow
                    : AppColors.green;
            final label = days < 0
                ? 'просрочено ${-days} дн.'
                : days == 0
                    ? 'сегодня!'
                    : 'через $days дн.';
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(e.category.icon, size: 16, color: color),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(e.title,
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  Text(
                    '${_amount(e.amount, e.currency)} · ${DateFormat('d MMM', 'ru').format(e.nextDue!)} · $label',
                    style: TextStyle(
                        color: color,
                        fontSize: 12,
                        fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, Expense e) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить расход?'),
        content: Text('«${e.title}» — ${_amount(e.amount, e.currency)}'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Отмена')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Удалить',
                  style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (yes == true && context.mounted) {
      await context.read<AppState>().deleteExpense(e);
    }
  }

  void _openAddSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _AddExpenseSheet(),
    );
  }
}

/// Сегментированный переключатель периодов: единый пилл-контейнер, активный
/// сегмент — с градиентом. Читаемее, чем три отдельных кнопки с зазором.
class _PeriodSegmented extends StatelessWidget {
  final List<String> labels;
  final int current;
  final ValueChanged<int> onChanged;

  const _PeriodSegmented({
    required this.labels,
    required this.current,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.bgDark,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: List.generate(labels.length, (i) {
          final active = i == current;
          return Expanded(
            child: FocusableTap(
              autofocus: i == 0,
              onTap: () => onChanged(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                padding: const EdgeInsets.symmetric(vertical: 9),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: active ? AppColors.accentGradient : null,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  labels[i],
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: active ? Colors.white : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _ExpenseCard extends StatelessWidget {
  final Expense expense;
  final VoidCallback onDelete;
  const _ExpenseCard({required this.expense, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final e = expense;
    return DarkCard(
      padding: const EdgeInsets.all(14),
      onLongPress: onDelete,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.bgDark,
              borderRadius: BorderRadius.circular(14),
            ),
            child: ShaderMask(
              shaderCallback: (b) => AppColors.accentGradient.createShader(b),
              child: Icon(e.category.icon, color: Colors.white, size: 22),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e.title,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(
                  'оплачено ${DateFormat('d MMM yyyy', 'ru').format(e.paidAt)}'
                  '${e.nextDue != null ? ' · след. ${DateFormat('d MMM', 'ru').format(e.nextDue!)}' : ''}',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 12),
                ),
                if (e.receiptUrl != null)
                  FocusableTap(
                    onTap: () => launchUrl(Uri.parse(e.receiptUrl!),
                        mode: LaunchMode.externalApplication),
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.attach_file_rounded,
                              size: 14, color: AppColors.cyan),
                          const SizedBox(width: 3),
                          Flexible(
                            child: Text(
                              e.receiptName ?? 'чек',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  color: AppColors.cyan, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _amount(e.amount, e.currency),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

/// Форма добавления расхода (bottom sheet).
class _AddExpenseSheet extends StatefulWidget {
  const _AddExpenseSheet();

  @override
  State<_AddExpenseSheet> createState() => _AddExpenseSheetState();
}

class _AddExpenseSheetState extends State<_AddExpenseSheet> {
  final _titleCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  ExpenseCategory _category = ExpenseCategory.openai;
  String _currency = 'USD';
  DateTime _paidAt = DateTime.now();
  DateTime? _nextDue;
  Uint8List? _fileBytes;
  String? _fileName;
  bool _saving = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _amountCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final res = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
      withData: true,
    );
    final f = res?.files.firstOrNull;
    if (f?.bytes != null) {
      setState(() {
        _fileBytes = f!.bytes;
        _fileName = f.name;
      });
    }
  }

  Future<DateTime?> _pickDate(DateTime initial) => showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: DateTime(2023),
        lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
        locale: const Locale('ru'),
      );

  Future<void> _save() async {
    final title = _titleCtrl.text.trim();
    final amount =
        double.tryParse(_amountCtrl.text.trim().replaceAll(',', '.'));
    if (title.isEmpty || amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Укажи название и сумму (числом)')));
      return;
    }
    setState(() => _saving = true);
    try {
      await context.read<AppState>().addExpense(
            title: title,
            category: _category,
            amount: amount,
            currency: _currency,
            paidAt: _paidAt,
            nextDue: _nextDue,
            receiptBytes: _fileBytes,
            receiptName: _fileName,
          );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Ошибка: $e')));
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('d MMMM yyyy', 'ru');
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Новый расход',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                  hintText: 'Название: OpenAI кредиты, Railway…'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _amountCtrl,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                        hintText: _currency == 'KZT'
                            ? 'Сумма в тенге, напр. 2500'
                            : 'Сумма в долларах, напр. 5'),
                  ),
                ),
                const SizedBox(width: 10),
                ...['USD', 'KZT'].map((c) {
                  final active = _currency == c;
                  return Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: FocusableTap(
                      onTap: () => setState(() => _currency = c),
                      child: Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: active ? AppColors.accentGradient : null,
                          color: active ? null : AppColors.surface,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(
                          c == 'KZT' ? '₸' : '\$',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color:
                                active ? Colors.white : AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ),
                  );
                }),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: ExpenseCategory.values.map((c) {
                final active = _category == c;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FocusableTap(
                    onTap: () => setState(() => _category = c),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        gradient: active ? AppColors.accentGradient : null,
                        color: active ? null : AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          Icon(c.icon,
                              size: 15,
                              color: active
                                  ? Colors.white
                                  : AppColors.textSecondary),
                          const SizedBox(width: 5),
                          Text(
                            c.label,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: active
                                  ? Colors.white
                                  : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 14),
            _dateRow(
              icon: Icons.event_available_rounded,
              label: 'Дата оплаты: ${fmt.format(_paidAt)}',
              onTap: () async {
                final d = await _pickDate(_paidAt);
                if (d != null) setState(() => _paidAt = d);
              },
            ),
            const SizedBox(height: 8),
            _dateRow(
              icon: Icons.notifications_active_rounded,
              label: _nextDue == null
                  ? 'Следующая оплата: не задана'
                  : 'Следующая оплата: ${fmt.format(_nextDue!)}',
              onTap: () async {
                final d = await _pickDate(
                    _nextDue ?? DateTime.now().add(const Duration(days: 30)));
                if (d != null) setState(() => _nextDue = d);
              },
              onClear: _nextDue == null
                  ? null
                  : () => setState(() => _nextDue = null),
            ),
            const SizedBox(height: 8),
            _dateRow(
              icon: Icons.attach_file_rounded,
              label: _fileName ?? 'Прикрепить чек (PDF или скриншот)',
              onTap: _pickFile,
              onClear: _fileName == null
                  ? null
                  : () => setState(() {
                        _fileBytes = null;
                        _fileName = null;
                      }),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                label: _saving ? 'Сохраняю…' : 'Добавить расход',
                icon: Icons.check_rounded,
                onTap: _saving ? null : _save,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dateRow({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    VoidCallback? onClear,
  }) {
    return FocusableTap(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: AppColors.cyan),
            const SizedBox(width: 10),
            Expanded(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13.5)),
            ),
            if (onClear != null)
              FocusableTap(
                onTap: onClear,
                child: const Icon(Icons.close_rounded,
                    size: 16, color: AppColors.textSecondary),
              ),
          ],
        ),
      ),
    );
  }
}
