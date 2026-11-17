import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/common.dart';

// Masters / Agents / Users / Admins — list with search and balances, "+ အသစ်", and a detail page:
// edit, status, unlimited wallet, reset password, deposit / withdraw, wallet history (and the
// accounts under a master or an agent). Admin accounts have no wallet: only their details, status
// and password. A master signed in sees only its own tree, an agent only its users (the server
// scopes every list).
// The admin opens every role, but an agent and a user never hang straight under it: it picks the
// master (for an agent) or the master / agent (for a user) they belong to. Its own cash still only
// moves in and out of a master, so the wallet buttons stay hidden on the accounts below those.
class AccountsScreen extends StatefulWidget {
  final String role; // master | agent | user | admin
  final int? parentId;
  const AccountsScreen({super.key, required this.role, this.parentId});

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

const roleTitles = {'master': 'Masters', 'agent': 'Agents', 'user': 'Users', 'admin': 'Admins'};
const roleNames = {'master': 'Master', 'agent': 'Agent', 'user': 'User', 'admin': 'Admin'};

const accountStatus = <String, (String, Color)>{
  'active': ('အသုံးပြုနေ', Color(0xFF059669)),
  'suspended': ('ရပ်ဆိုင်းထား', Color(0xFFD97706)),
  'closed': ('ပိတ်ထား', Color(0xFF64748B)),
};

class _AccountsScreenState extends State<AccountsScreen> {
  final _loader = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();
  String search = '';

  String get title => roleTitles[widget.role]!;
  bool get isAdmins => widget.role == 'admin';

  // Roles each signed-in account opens itself (same rule as src/routes/users.js).
  static const _creates = {
    'admin': {'master', 'admin', 'agent', 'user'},
    'master': {'agent', 'user'},
    'agent': {'user'},
  };
  bool canCreate(Session session) => (_creates[session.role] ?? const <String>{}).contains(widget.role);
  bool canSetHotEdit(Session session) => session.isAdmin && widget.role == 'master';

  Future<void> _setHotEdit(Map<String, dynamic> u, bool on, Future<void> Function() reload) async {
    try {
      await Api.instance.patch('/users/${asInt(u['id'])}', {'hot_edit': on});
      if (!mounted) return;
      snack(context, on ? 'ဟော့ဂဏန်း ပြင်ခွင့် ပေးပြီး' : 'ဟော့ဂဏန်း ပြင်ခွင့် ပိတ်ပြီး');
      reload();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final q = widget.parentId != null ? '&parent_id=${widget.parentId}' : '';
    return ((await Api.instance.get('/users?role=${widget.role}$q')) as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
  }

  Future<void> _add() async {
    final created = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(
        builder: (_) => AccountFormScreen(role: widget.role, parentId: widget.parentId),
      ),
    );
    if (created != null) _loader.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      floatingActionButton: canCreate(session)
          ? FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.person_add), label: Text('$title အသစ်'))
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'အမည် / Username / ဖုန်း', isDense: true, border: OutlineInputBorder()),
              onChanged: (v) => setState(() => search = v.trim().toLowerCase()),
            ),
          ),
          Expanded(
            child: Loader<List<Map<String, dynamic>>>(
              key: _loader,
              load: _load,
              builder: (ctx, all, reload) {
                final rows = all.where((u) => search.isEmpty || '${u['username']} ${u['name']} ${u['phone'] ?? ''}'.toLowerCase().contains(search)).toList();
                final total = rows.fold<int>(0, (a, u) => a + asInt(u['balance']));
                if (rows.isEmpty) return const EmptyView('မရှိပါ', icon: Icons.person_off);
                return ListView(
                  padding: const EdgeInsets.only(bottom: 90),
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                      child: Text(
                        isAdmins ? '${rows.length} ဦး' : '${rows.length} ဦး · လက်ကျန်စုစုပေါင်း ${session.money(total)} Ks',
                        style: TextStyle(color: Colors.grey[700], fontWeight: FontWeight.w600),
                      ),
                    ),
                    for (final u in rows)
                      ListTile(
                        leading: CircleAvatar(
                          backgroundColor:
                              (isAdmins
                                      ? const Color(0xFF4338CA)
                                      : widget.role == 'master'
                                      ? const Color(0xFFBE185D)
                                      : widget.role == 'agent'
                                      ? const Color(0xFFEA580C)
                                      : const Color(0xFF0EA5E9))
                                  .withValues(alpha: .15),
                          child: Text('${u['username']}'.substring(0, 1).toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w900)),
                        ),
                        title: Row(
                          children: [
                            Flexible(
                              child: Text(
                                '${u['username']}',
                                style: const TextStyle(fontWeight: FontWeight.w800),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 6),
                            if (u['status'] != 'active')
                              () {
                                final (l, c) = accountStatus[u['status']] ?? ('${u['status']}', Colors.grey);
                                return StatusChip(l, c);
                              }(),
                            if (asInt(u['unlimited']) == 1)
                              const Text(
                                ' ∞',
                                style: TextStyle(color: Color(0xFF7C3AED), fontWeight: FontWeight.w900),
                              ),
                          ],
                        ),
                        subtitle: Text(
                          [
                            u['name'],
                            // The account above (left out when it is the signed-in master itself).
                            if (widget.role != 'master' && u['parent_username'] != null && asInt(u['parent_id']) != session.id)
                              '${widget.role == 'agent' ? 'Master' : 'အထက်'}: ${u['parent_username']}',
                            if (widget.role == 'agent') 'Users ${u['child_count']}',
                            if (widget.role == 'master') 'အောက်အကောင့် ${u['child_count']}',
                          ].whereType<Object>().join(' · '),
                          style: const TextStyle(fontSize: 12),
                        ),
                        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                          if (canSetHotEdit(session))
                            Tooltip(
                              message: 'ဟော့ဂဏန်း ပြင်ခွင့်',
                              child: Switch(
                                value: asInt(u['hot_edit']) == 1,
                                onChanged: (on) => _setHotEdit(u, on, reload),
                              ),
                            ),
                          isAdmins
                              ? Text(u['phone'] != null ? '${u['phone']}' : '', style: const TextStyle(fontSize: 12))
                              : Text(
                                  session.money(asInt(u['balance'])),
                                  style: TextStyle(fontWeight: FontWeight.w900, color: asInt(u['balance']) < 0 ? const Color(0xFFDC2626) : null),
                                ),
                        ]),
                        onTap: () async {
                          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => AccountDetailScreen(userId: asInt(u['id']))));
                          reload();
                        },
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// New or edit account.
class AccountFormScreen extends StatefulWidget {
  final String role;
  final int? parentId;
  final Map<String, dynamic>? account; // null = new
  const AccountFormScreen({super.key, required this.role, this.parentId, this.account});

  @override
  State<AccountFormScreen> createState() => _AccountFormScreenState();
}

class _AccountFormScreenState extends State<AccountFormScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _nameMm = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  bool unlimited = false;
  String status = 'active';
  int? parentId;
  List<Map<String, dynamic>> uplines = []; // accounts the new one may hang under, beside the creator
  bool busy = false;
  String? error;

  bool get isNew => widget.account == null;
  bool get isAdmin => widget.role == 'admin';
  // The admin opening an agent / a user: it cannot be their upline, so one has to be picked.
  bool get mustPickUpline =>
      isNew && context.read<Session>().isAdmin && const {'agent', 'user'}.contains(widget.role);
  // Editing one's own account (Profile): no status / unlimited change (the server refuses both).
  bool get isSelf => !isNew && asInt(widget.account!['id']) == asInt(context.read<Session>().user?['id']);

  @override
  void initState() {
    super.initState();
    final a = widget.account;
    parentId = widget.parentId;
    if (a != null) {
      _name.text = '${a['name'] ?? ''}';
      _nameMm.text = '${a['name_mm'] ?? ''}';
      _phone.text = '${a['phone'] ?? ''}';
      _address.text = '${a['address'] ?? ''}';
      unlimited = asInt(a['unlimited']) == 1;
      status = '${a['status']}';
    }
    // A new user may hang under an agent (or, for the admin, a master); a new agent under a master
    // (admin only). Left empty, it goes straight under the signed-in account.
    final session = context.read<Session>();
    // The accounts the new one may hang under, besides the signed-in account itself: a master's own
    // agents for a new user, and for the admin the master (new agent) or master / agent (new user)
    // it has to name — the admin is no upline for either (src/routes/users.js).
    final roles = session.isAdmin
        ? (widget.role == 'agent' ? ['master'] : widget.role == 'user' ? ['master', 'agent'] : <String>[])
        : (widget.role == 'user' && session.isMaster ? ['agent'] : <String>[]);
    if (isNew && roles.isNotEmpty) {
      Future.wait([for (final r in roles) Api.instance.get('/users?role=$r')])
          .then((lists) {
            if (mounted) {
              setState(() => uplines = [for (final l in lists) ...(l as List).map((r) => Map<String, dynamic>.from(r as Map))]);
            }
          })
          .catchError((_) {});
    }
  }

  Future<void> _save() async {
    setState(() {
      busy = true;
      error = null;
    });
    if (mustPickUpline && parentId == null) {
      return setState(() {
        busy = false;
        error = widget.role == 'agent' ? 'ဘယ် Master အောက်လဲ ရွေးပါ' : 'ဘယ် Master / Agent အောက်လဲ ရွေးပါ';
      });
    }
    String? opt(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    try {
      final Object saved;
      if (isNew) {
        saved = await Api.instance.post('/users', {
          'username': _username.text.trim(),
          'password': _password.text,
          'role': widget.role,
          if (parentId != null) 'parent_id': parentId,
          'name': _name.text.trim(),
          if (opt(_nameMm) != null) 'name_mm': opt(_nameMm),
          if (opt(_phone) != null) 'phone': opt(_phone),
          if (opt(_address) != null) 'address': opt(_address),
          if (!isAdmin) 'unlimited': unlimited,
        });
      } else {
        saved = await Api.instance.patch('/users/${widget.account!['id']}', {
          'name': _name.text.trim(),
          'name_mm': opt(_nameMm),
          'phone': opt(_phone),
          'address': opt(_address),
          if (!isSelf) 'status': status,
          if (!isAdmin && !isSelf) 'unlimited': unlimited,
          if (_password.text.isNotEmpty) 'password': _password.text,
        });
      }
      if (mounted) Navigator.pop(context, Map<String, dynamic>.from(saved as Map));
    } catch (e) {
      setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String l, {String? hint}) => InputDecoration(labelText: l, hintText: hint, border: const OutlineInputBorder(), isDense: true);
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(isNew ? '${roleNames[widget.role]} အသစ်' : 'ပြင်ရန် — ${widget.account!['username']}')),
      body: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          if (error != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(10)),
              child: Text(error!, style: const TextStyle(color: Colors.red)),
            ),
          if (isNew) ...[
            TextField(
              controller: _username,
              autocorrect: false,
              decoration: deco('Username', hint: 'a-z 0-9 _ .'),
            ),
            gap,
          ],
          if (!isSelf)
            TextField(
              controller: _password,
              obscureText: true,
              keyboardType: TextInputType.visiblePassword,
              autocorrect: false,
              enableSuggestions: false,
              decoration: deco(isNew ? 'Password (အနည်းဆုံး ၆ လုံး)' : 'Password အသစ် (ပြောင်းမှ ဖြည့်ပါ)'),
            ),
          if (!isSelf) gap,
          if (isNew && uplines.isNotEmpty && widget.parentId == null) ...[
            DropdownButtonFormField<int?>(
              initialValue: parentId,
              isExpanded: true,
              decoration: deco(widget.role == 'agent' ? 'Master' : mustPickUpline ? 'Master / Agent' : 'Agent'),
              items: [
                DropdownMenuItem(
                  value: null,
                  child: Text(mustPickUpline
                      ? (widget.role == 'agent' ? '— Master ရွေးပါ —' : '— Master / Agent ရွေးပါ —')
                      : '— ကျွန်ုပ်အောက် တိုက်ရိုက် —'),
                ),
                for (final a in uplines)
                  DropdownMenuItem(
                    value: asInt(a['id']),
                    child: Text('${a['role'] == 'master' ? '◆ ' : ''}${a['username']} · ${a['name']}'),
                  ),
              ],
              onChanged: (v) => setState(() => parentId = v),
            ),
            gap,
          ],
          TextField(controller: _name, decoration: deco('အမည်')),
          gap,
          TextField(controller: _nameMm, decoration: deco('မြန်မာအမည်')),
          gap,
          TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: deco('ဖုန်း')),
          gap,
          TextField(controller: _address, decoration: deco('လိပ်စာ')),
          gap,
          if (!isNew && !isSelf) ...[
            DropdownButtonFormField<String>(
              initialValue: status,
              decoration: deco('အခြေအနေ'),
              items: [for (final e in accountStatus.entries) DropdownMenuItem(value: e.key, child: Text(e.value.$1))],
              onChanged: (v) => setState(() => status = v ?? status),
            ),
            gap,
          ],
          if (!isAdmin && !isSelf)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: unlimited,
              onChanged: (v) => setState(() => unlimited = v),
              title: const Text('∞ အကန့်အသတ်မဲ့ Wallet', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(widget.role == 'user' ? 'လက်ကျန်မရှိလည်း ထိုးနိုင် (အကြွေး)' : 'လက်ကျန်မရှိလည်း အောက်အကောင့်များကို ငွေဖြည့်ပေးနိုင်'),
            ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: busy ? null : _save,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
            icon: const Icon(Icons.save),
            label: Text(isNew ? 'ဖန်တီးမည်' : 'သိမ်းမည်'),
          ),
        ],
      ),
    );
  }
}

class AccountDetailScreen extends StatefulWidget {
  final int userId;
  const AccountDetailScreen({super.key, required this.userId});

  @override
  State<AccountDetailScreen> createState() => _AccountDetailScreenState();
}

const walletType = <String, String>{
  'deposit': 'ငွေသွင်း',
  'withdraw': 'ငွေထုတ်',
  'transfer_in': 'ငွေလွှဲဝင်',
  'transfer_out': 'ငွေလွှဲထွက်',
  'bet': 'ထိုးငွေ',
  'win': 'ဆုငွေ',
  'refund': 'ငွေပြန်အမ်း',
  'commission': 'ကော်မရှင်',
  'adjust': 'ပြင်ဆင်',
};

class _AccountDetailScreenState extends State<AccountDetailScreen> {
  Map<String, dynamic>? user;
  List<Map<String, dynamic>> wallet = [];
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([Api.instance.get('/users/${widget.userId}'), Api.instance.get('/wallet/transactions?user_id=${widget.userId}&limit=100')]);
      if (!mounted) return;
      setState(() {
        user = Map<String, dynamic>.from(results[0] as Map);
        wallet = (results[1] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
  }

  Future<void> _move(String kind) async {
    final u = user!;
    final amount = TextEditingController();
    final note = TextEditingController();
    final deposit = kind == 'deposit';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(deposit ? 'ငွေသွင်း — ${u['username']}' : 'ငွေထုတ် — ${u['username']}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amount,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              decoration: const InputDecoration(labelText: 'ပမာဏ (ကျပ်)', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: note,
              decoration: const InputDecoration(labelText: 'မှတ်ချက် (မဖြည့်လည်းရ)', border: OutlineInputBorder(), isDense: true),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('မလုပ်တော့ပါ')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: deposit ? const Color(0xFF059669) : const Color(0xFFEA580C)),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(deposit ? 'ငွေသွင်းမည်' : 'ငွေထုတ်မည်'),
          ),
        ],
      ),
    );
    final value = int.tryParse(amount.text) ?? 0;
    if (ok != true || value <= 0) return;
    try {
      await Api.instance.post('/wallet/$kind', {'user_id': asInt(u['id']), 'amount': value, if (note.text.trim().isNotEmpty) 'note': note.text.trim()});
      if (mounted) snack(context, deposit ? 'ငွေသွင်းပြီးပါပြီ' : 'ငွေထုတ်ပြီးပါပြီ');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _setHotEdit(bool on) async {
    try {
      await Api.instance.patch('/users/${widget.userId}', {'hot_edit': on});
      if (mounted) snack(context, on ? 'ဟော့ဂဏန်း ပြင်ခွင့် ပေးပြီး' : 'ဟော့ဂဏန်း ပြင်ခွင့် ပိတ်ပြီး');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _setSaleOver(bool on) async {
    try {
      await Api.instance.patch('/users/${widget.userId}', {'sale_over': on});
      if (mounted) snack(context, on ? 'အကျွံများသိမ်း ခွင့်ပြုပြီး' : 'အကျွံများသိမ်း ပိတ်ပြီး');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  // Role ပြောင်းရန် (admin only): e.g. an old view-only admin into a user. Login, password and
  // history stay; the server refuses changes that would break the tree or the ledger.
  Future<void> _changeRole() async {
    final u = user!;
    List<Map<String, dynamic>> uplines = [];
    try {
      uplines = ((await Api.instance.get('/users')) as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .where((a) => asInt(a['id']) != asInt(u['id']) && const {'admin', 'master', 'agent'}.contains(a['role']))
          .toList();
    } catch (e) {
      if (mounted) errorSnack(context, e);
      return;
    }
    if (!mounted) return;
    // Role change goes by the server's PARENT_ROLES: an account opened before the "no agent / user
    // straight under the admin" rule may still sit there, so admin stays in the list.
    const parentRoles = {'master': ['admin'], 'agent': ['admin', 'master'], 'user': ['admin', 'master', 'agent']};
    String role = '${u['role']}';
    int? parentId = u['parent_id'] == null ? null : asInt(u['parent_id']);
    final picked = await showDialog<(String, int?)>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSt) {
        final allowed = parentRoles[role] ?? const <String>[];
        final options = uplines.where((a) => allowed.contains(a['role'])).toList();
        if (!options.any((a) => asInt(a['id']) == parentId)) parentId = null;
        return AlertDialog(
          title: Text('Role ပြောင်းရန် — ${u['username']}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: role,
              decoration: const InputDecoration(labelText: 'Role', border: OutlineInputBorder(), isDense: true),
              items: [for (final r in roleNames.entries) DropdownMenuItem(value: r.key, child: Text(r.value))],
              onChanged: (v) => setSt(() => role = v ?? role),
            ),
            const SizedBox(height: 12),
            if (role != 'admin')
              DropdownButtonFormField<int?>(
                key: ValueKey('parent-$role'),
                initialValue: parentId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'အထက်အကောင့်', border: OutlineInputBorder(), isDense: true),
                items: [
                  const DropdownMenuItem(value: null, child: Text('အလိုအလျောက် (လက်ရှိ အထက် / Admin)')),
                  for (final a in options)
                    DropdownMenuItem(value: asInt(a['id']), child: Text('${a['username']} · ${roleNames[a['role']] ?? a['role']}', overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setSt(() => parentId = v),
              ),
            const SizedBox(height: 8),
            Text('Login၊ password၊ ငွေစာရင်း မှတ်တမ်းများ မပြောင်းပါ။', style: TextStyle(fontSize: 12, color: Colors.grey[600])),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('မလုပ်တော့ပါ')),
            FilledButton(onPressed: () => Navigator.pop(ctx, (role, role == 'admin' ? null : parentId)), child: const Text('ပြောင်းမည်')),
          ],
        );
      }),
    );
    if (picked == null) return;
    try {
      final r = await Api.instance.put('/users/${u['id']}/role', {'role': picked.$1, if (picked.$2 != null) 'parent_id': picked.$2}) as Map;
      if (mounted) snack(context, '${r['username']} → ${roleNames[r['role']] ?? r['role']}');
      _load();
    } catch (e) {
      if (mounted) errorSnack(context, e);
    }
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(
        builder: (_) => AccountFormScreen(role: '${user!['role']}', account: user),
      ),
    );
    if (saved != null) _load();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();
    final u = user;
    if (u == null) {
      return Scaffold(
        appBar: AppBar(),
        body: error != null ? ErrorView(message: error!, onRetry: _load) : const Center(child: CircularProgressIndicator()),
      );
    }
    final (sLabel, sColor) = accountStatus[u['status']] ?? ('${u['status']}', Colors.grey);
    final isAgent = u['role'] == 'agent';
    final isMaster = u['role'] == 'master';
    final isAdmin = u['role'] == 'admin';
    final isSelf = asInt(u['id']) == session.id;
    // can_manage false: an account outside the caller's tree, opened through view-all — read only.
    final manage = u['can_manage'] != false;
    final canSetSaleOver = session.isAdmin && manage && !isSelf && (isMaster || isAgent);
    final canSetHotEdit = session.isAdmin && manage && !isSelf && isMaster;
    // The admin's own cash only moves in and out of a master (src/routes/wallet.js); a master or an
    // agent hands its own balance to anyone in its tree.
    final canMove = manage && !isSelf && (session.isAdmin ? isMaster : true);
    return Scaffold(
      appBar: AppBar(
        title: Text('${u['username']}'),
        actions: [
          if (session.isAdmin && !isSelf)
            IconButton(icon: const Icon(Icons.swap_horiz), tooltip: 'Role ပြောင်းရန်', onPressed: _changeRole),
          if (manage) IconButton(icon: const Icon(Icons.edit), tooltip: 'ပြင်ရန်', onPressed: _edit),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            SectionCard(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${u['name']}${(u['name_mm'] ?? '').toString().isNotEmpty ? ' · ${u['name_mm']}' : ''}',
                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17),
                          ),
                          Text(
                            '${roleNames[u['role']] ?? u['role']} · ${u['phone'] ?? '-'}',
                            style: TextStyle(color: Colors.grey[700]),
                          ),
                          if (u['address'] != null) Text('${u['address']}', style: TextStyle(color: Colors.grey[700], fontSize: 12.5)),
                        ],
                      ),
                    ),
                    StatusChip(sLabel, sColor),
                  ],
                ),
                if (!isAdmin) ...[
                  const Divider(height: 22),
                  const Text('လက်ကျန်ငွေ', style: TextStyle(color: Colors.grey)),
                  Text(
                    '${session.money(asInt(u['balance']))} ကျပ်${asInt(u['unlimited']) == 1 ? '  ∞' : ''}',
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: asInt(u['balance']) < 0 ? const Color(0xFFDC2626) : null),
                  ),
                  // A master hands over its own money (the server takes it from its balance).
                  if (session.isDownline && !isSelf)
                    Text(
                      'ငွေသွင်းလျှင် ကိုယ်ပိုင်လက်ကျန်မှ နုတ်မည်၊ ငွေထုတ်လျှင် ကိုယ်ပိုင်လက်ကျန်ထဲ ပြန်ဝင်မည်',
                      style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                    ),
                  const SizedBox(height: 10),
                  if (!manage)
                    Text('ကြည့်ရုံသာ — ဤအကောင့်သည် သင့်အောက်တွင် မရှိပါ', style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                  if (session.isAdmin && !isSelf && manage && !isMaster)
                    Text('Admin သည် Master အကောင့်များကိုသာ ငွေသွင်း / ငွေထုတ် လုပ်နိုင်ပါသည် — ဤအကောင့်ကို သက်ဆိုင်ရာ Master / Agent က ထည့်ပေးရပါမည်။',
                        style: TextStyle(fontSize: 12, color: Colors.grey[600])),
                  if (canMove) Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(backgroundColor: const Color(0xFF059669)),
                          onPressed: () => _move('deposit'),
                          icon: const Icon(Icons.add),
                          label: const Text('ငွေသွင်း'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(backgroundColor: const Color(0xFFEA580C)),
                          onPressed: () => _move('withdraw'),
                          icon: const Icon(Icons.remove),
                          label: const Text('ငွေထုတ်'),
                        ),
                      ),
                    ],
                  ),
                  if (isMaster) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => AccountsScreen(role: 'agent', parentId: asInt(u['id']))),
                      ),
                      icon: const Icon(Icons.support_agent),
                      label: const Text('ဤ Master ၏ Agents'),
                    ),
                  ],
                  if (isAgent || isMaster) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AccountsScreen(role: 'user', parentId: asInt(u['id'])),
                        ),
                      ),
                      icon: const Icon(Icons.groups),
                      label: Text(isMaster ? 'ဤ Master အောက် တိုက်ရိုက် Users' : 'ဤ Agent ၏ Users'),
                    ),
                  ],
                ],
              ],
            ),
            if (canSetHotEdit)
              SectionCard(children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: asInt(u['hot_edit']) == 1,
                  onChanged: _setHotEdit,
                  title: const Text('ဟော့ဂဏန်း ပြင်ခွင့်', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('ခွင့်ပြုလျှင် ဤ Master သည် အပါတ်စဥ်၏ ဟော့ဂဏန်းများကို ထည့် / ပြင်နိုင်မည်'),
                ),
              ]),
            if (canSetSaleOver)
              SectionCard(children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: asInt(u['sale_over']) == 1,
                  onChanged: _setSaleOver,
                  title: const Text('အကျွံများသိမ်း', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('ခွင့်ပြုထားလျှင် ဤအကောင့်သည် အရောင်းတွင် ဘရိတ်ကျော်၍ သိမ်းနိုင်မည်'),
                ),
              ]),
            if (!isAdmin)
              SectionCard(
                title: 'ငွေစာရင်း',
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
                children: [
                  if (wallet.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(12),
                      child: Text('မရှိသေးပါ', style: TextStyle(color: Colors.grey)),
                    ),
                  for (final w in wallet)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        border: Border(bottom: BorderSide(color: Colors.grey.shade200)),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(walletType[w['type']] ?? '${w['type']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text([dateTime(w['created_at']), if (w['note'] != null) '${w['note']}'].join(' · '), style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                '${asInt(w['amount']) > 0 ? '+' : ''}${session.money(asInt(w['amount']))}',
                                style: TextStyle(fontWeight: FontWeight.w800, color: asInt(w['amount']) < 0 ? const Color(0xFFDC2626) : const Color(0xFF059669)),
                              ),
                              Text(session.money(asInt(w['balance_after'])), style: TextStyle(fontSize: 11.5, color: Colors.grey[600])),
                            ],
                          ),
                        ],
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
