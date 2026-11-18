import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/format.dart';
import '../widgets/common.dart';
import 'term_detail_screen.dart';

// Purchase screen: lists open/closed terms so the master can buy excess units from another dealer.
// Works the same as ActiveTermsScreen but taps open TermDetailScreen(purchaseMode: true).
class PurchaseTermsScreen extends StatefulWidget {
  const PurchaseTermsScreen({super.key});

  @override
  State<PurchaseTermsScreen> createState() => _PurchaseTermsScreenState();
}

class _PurchaseTermsScreenState extends State<PurchaseTermsScreen> {
  List<Map<String, dynamic>> terms = [];
  bool loading = true;
  String? error;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(seconds: 60), (_) => _load(quiet: true));
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

  Future<void> _openPurchase(Map<String, dynamic> t) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => TermDetailScreen(termId: asInt(t['id']), purchaseMode: true)),
    );
    _load(quiet: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('အဝယ်'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? ErrorView(message: error!, onRetry: _load)
              : terms.isEmpty
                  ? const Center(child: Text('Active term မရှိသေးပါ', style: TextStyle(fontSize: 15)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: terms.length,
                        itemBuilder: (_, i) {
                          final t = terms[i];
                          return ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.shopping_bag_outlined)),
                            title: Text('${t['description']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text('${t['game']} · ပိတ် ${timeOnly(t['close_at'])}'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _openPurchase(t),
                          );
                        },
                      ),
                    ),
    );
  }
}
