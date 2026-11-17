import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/session.dart';

ImageProvider? _masterLogo(String? logo) {
  final s = logo ?? '';
  if (s.startsWith('http://') || s.startsWith('https://')) return NetworkImage(s);
  final comma = s.indexOf(',');
  if (!s.startsWith('data:image') || comma < 0) return null;
  try {
    return MemoryImage(base64Decode(s.substring(comma + 1)));
  } catch (_) {
    return null;
  }
}

// Admin / master / agent login (those three roles only). The ⚙ button sets which OnlineLotto server to use.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _u = TextEditingController();
  final _p = TextEditingController();
  bool busy = false;
  bool obscure = true;
  bool remember = true; // Remember me
  String? masterLogo;
  Timer? _logoTimer;

  @override
  void initState() {
    super.initState();
    _u.text = Api.instance.rememberedUsername;
    masterLogo = _cachedLogo(_u.text);
    _u.addListener(_scheduleLogo);
    if (_u.text.trim().isNotEmpty) _loadLogo();
  }
  String? error;

  @override
  void dispose() {
    _logoTimer?.cancel();
    _u.removeListener(_scheduleLogo);
    _u.dispose();
    _p.dispose();
    super.dispose();
  }

  String? _cachedLogo(String username) {
    final name = username.trim();
    if (name.isEmpty || Api.instance.brandUser != name) return null;
    final logo = Api.instance.brandLogo;
    return (logo == null || logo.isEmpty) ? null : logo;
  }

  void _scheduleLogo() {
    _logoTimer?.cancel();
    _logoTimer = Timer(const Duration(milliseconds: 250), () {
      final cached = _cachedLogo(_u.text);
      if (mounted && masterLogo != cached) setState(() => masterLogo = cached);
      _loadLogo();
    });
  }

  Future<void> _loadLogo() async {
    final name = _u.text.trim();
    if (name.isEmpty) {
      if (mounted) setState(() => masterLogo = null);
      return;
    }
    try {
      final r = await Api.instance.get('/auth/brand?username=${Uri.encodeQueryComponent(name)}');
      final raw = r is Map ? r['logo']?.toString() : null;
      final logo = (raw == null || raw.isEmpty) ? null : raw;
      await Api.instance.saveBrandLogo(name, logo);
      if (mounted && _u.text.trim() == name) setState(() => masterLogo = logo);
    } catch (_) {
      // Keep the saved picture when the server cannot be reached.
    }
  }

  Future<void> _submit() async {
    if (_u.text.trim().isEmpty || _p.text.isEmpty) {
      setState(() => error = 'အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်ပါ');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      // MaterialApp's home switches to the dashboard once the session has a user.
      await context.read<Session>().login(_u.text.trim(), _p.text, remember: remember);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _logo() {
    final provider = _masterLogo(masterLogo);
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: provider == null
          ? Image.asset('assets/icon/icon.png', width: 88, height: 88, fit: BoxFit.cover)
          : Image(image: provider, width: 88, height: 88, fit: BoxFit.cover, errorBuilder: (_, _, _) => Image.asset('assets/icon/icon.png', width: 88, height: 88, fit: BoxFit.cover)),
    );
  }

  Future<void> _editServer() async {
    final ctrl = TextEditingController(text: Api.instance.server);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Online Server'),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(labelText: 'Server address', hintText: 'https://online-lottosale-multifilesystem.onrender.com', border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('သိမ်းမည်')),
        ],
      ),
    );
    if (saved == true) {
      await Api.instance.setServer(ctrl.text);
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(children: [
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(child: _logo()),
                    const SizedBox(height: 8),
                    const Text('Admin Lotto', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 24),
                    if (error != null)
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(11),
                        decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(10)),
                        child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
                      ),
                    TextField(
                      controller: _u,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Username', border: OutlineInputBorder(), prefixIcon: Icon(Icons.person)),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _p,
                      obscureText: obscure,
                      // visiblePassword + no suggestions: avoids an Android OEM keyboard bug where an
                      // obscured field's keyboard fails to open (same as the POS app).
                      keyboardType: TextInputType.visiblePassword,
                      enableSuggestions: false,
                      autocorrect: false,
                      onSubmitted: (_) => busy ? null : _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        border: const OutlineInputBorder(),
                        prefixIcon: const Icon(Icons.lock),
                        suffixIcon: IconButton(
                          icon: Icon(obscure ? Icons.visibility : Icons.visibility_off),
                          onPressed: () => setState(() => obscure = !obscure),
                        ),
                      ),
                    ),
                    // Remember me: stay signed in after closing the app, and keep the username.
                    CheckboxListTile(
                      value: remember,
                      onChanged: (v) => setState(() => remember = v ?? true),
                      title: const Text('Remember me (မှတ်ထားမည်)'),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: busy ? null : _submit,
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                      child: busy
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Login', style: TextStyle(fontSize: 16)),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: IconButton(icon: Icon(Icons.settings, color: Colors.grey[500]), tooltip: 'Online Server', onPressed: _editServer),
          ),
        ]),
      ),
    );
  }
}
