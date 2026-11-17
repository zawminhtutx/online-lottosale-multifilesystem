import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';
import '../widgets/responsive_layout.dart';
import 'bet_screen.dart';

// "အပါတ်စဥ်ရွေးရန်" — the open terms from the server (like the POS app's ActiveTermsScreen).
// Terms whose Ledger (betting opens) time is still ahead are listed greyed out until then.
class ActiveTermsScreen extends StatefulWidget {
  const ActiveTermsScreen({super.key});

  @override
  State<ActiveTermsScreen> createState() => _ActiveTermsScreenState();
}

class _ActiveTermsScreenState extends State<ActiveTermsScreen> {
  List<Map<String, dynamic>> terms = [];
  bool loading = true;
  String? error;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    // Re-evaluates open/upcoming and the countdowns; reloads from the server every minute.
    var n = 0;
    _tick = Timer.periodic(const Duration(seconds: 15), (_) {
      if (++n % 4 == 0) {
        _load(quiet: true);
      } else if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => loading = true);
    try {
      final rows = await Api.instance.get('/terms?status=open') as List;
      terms = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      error = null;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _openSale(Map<String, dynamic> t) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BetScreen(termId: asInt(t['id']))));
    if (mounted) {
      context.read<Session>().refresh();
      _load(quiet: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final open = terms.where((t) => isTermOpen(t, now)).toList();
    final upcoming = terms.where((t) {
      final opens = parseDate(t['open_at']);
      final closes = parseDate(t['close_at']);
      return opens != null && now.isBefore(opens) && (closes == null || now.isBefore(closes));
    }).toList().reversed.toList();

    // Dashboard look: open terms on the light highlight (tap the card to sell), terms not open yet
    // as glass cards with a lock.
    return DashScaffold(
      title: const Text('အပါတ်စဥ်ရွေးရန်', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
      actions: [
        GlassIconButton(icon: Icons.refresh, tooltip: 'Refresh', onPressed: _load),
        const SizedBox(width: 16),
      ],
      body: loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : error != null
              ? _ErrorView(message: error!, onRetry: _load)
              : open.isEmpty && upcoming.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.hourglass_top, size: 56, color: Colors.white.withValues(alpha: .6)),
                          const SizedBox(height: 12),
                          Text('🔴 Active term မရှိသေးပါ — နောက်အပါတ်စဥ် ဖွင့်ချိန်တွင် ပြန်လာပါ',
                              textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
                        ]),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ContentWidth(maxWidth: 720, child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        children: [
                          for (final t in open) ...[
                            // Open term: just its name — no unit price, no time to close, no ">".
                            _TermCard(term: t, onTap: () => _openSale(t)),
                            const SizedBox(height: 12),
                          ],
                          for (final t in upcoming) ...[
                            _TermCard(
                              term: t,
                              subtitle: '🕘 ဖွင့်ချိန် ${dateTime(t['open_at'])}',
                              trailing: timeLeft(t['open_at'], now),
                              trailingPrefix: 'ဖွင့်ရန် ',
                            ),
                            const SizedBox(height: 12),
                          ],
                        ],
                      )),
                    ),
    );
  }
}

class _TermCard extends StatelessWidget {
  final Map<String, dynamic> term;
  final String? subtitle;
  final String? trailing;
  final String trailingPrefix;
  final VoidCallback? onTap;
  const _TermCard({required this.term, this.subtitle, this.trailing, this.trailingPrefix = '', this.onTap});

  @override
  Widget build(BuildContext context) {
    final open = onTap != null; // open terms can be tapped; upcoming ones are locked
    final fg = open ? Dash.ink : Colors.white;
    final radius = BorderRadius.circular(22);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: radius,
        onTap: onTap,
        child: Ink(
          decoration: open ? BoxDecoration(gradient: Dash.highlight, borderRadius: radius) : Dash.glassBox(),
          child: Padding(
            // Larger text on this screen: term name 22, details 15, 2D/3D badge 28.
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Row(children: [
              GameCircle('${term['game']}', radius: 28),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${term['description']}', style: TextStyle(color: fg, fontWeight: FontWeight.w800, fontSize: 22)),
                  if (subtitle != null) Text(subtitle!, style: TextStyle(color: fg.withValues(alpha: .8), fontSize: 15)),
                  if (trailing != null)
                    Text('$trailingPrefix$trailing', style: const TextStyle(color: Dash.amber, fontWeight: FontWeight.w700, fontSize: 15)),
                ]),
              ),
              // Open terms: the whole card is the button (no "ရောင်းမည်" pill).
              if (!open) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), shape: BoxShape.circle),
                  child: const Icon(Icons.lock, color: Colors.white, size: 20),
                ),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off, color: Dash.red, size: 40),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 14),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: Dash.ink),
            onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('ပြန်ကြိုးစားရန်')),
        ]),
      ),
    );
  }
}
