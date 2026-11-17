import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api.dart';
import '../services/session.dart';
import '../widgets/dash_style.dart';

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

// Same layout as the POS mobile app's login. The ⚙ button sets which OnlineLotto server to use
// (kept on this phone); everything else is just username + password.
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
    _u.addListener(_scheduleLogo);
    _scheduleLogo();
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

  void _scheduleLogo() {
    _logoTimer?.cancel();
    _logoTimer = Timer(const Duration(milliseconds: 350), _loadLogo);
  }

  Future<void> _loadLogo() async {
    final name = _u.text.trim();
    if (name.isEmpty) {
      if (mounted) setState(() => masterLogo = null);
      return;
    }
    try {
      final r = await Api.instance.get('/auth/brand?username=${Uri.encodeQueryComponent(name)}');
      final logo = r is Map ? r['logo']?.toString() : null;
      if (mounted && _u.text.trim() == name) setState(() => masterLogo = (logo == null || logo.isEmpty) ? null : logo);
    } catch (_) {
      if (mounted && _u.text.trim() == name) setState(() => masterLogo = null);
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
    // Dashboard look: indigo gradient, glass fields and the lavender Login pill.
    return Scaffold(
      backgroundColor: Dash.bottom,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Dash.top, Dash.bottom]),
        ),
        child: SafeArea(
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
                      const SizedBox(height: 12),
                      const Text('Lotto',
                          textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFE0E7FF), fontSize: 28, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text('Login to bet', textAlign: TextAlign.center, style: TextStyle(color: Colors.white.withValues(alpha: .85))),
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                        decoration: Dash.glassBox(),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          if (error != null)
                            Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(11),
                              decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(12)),
                              child: Text(error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
                            ),
                          TextField(
                            controller: _u,
                            autocorrect: false,
                            textInputAction: TextInputAction.next,
                            style: const TextStyle(color: Colors.white),
                            cursorColor: Colors.white,
                            decoration: dashInput('Username', icon: Icons.person),
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
                            style: const TextStyle(color: Colors.white),
                            cursorColor: Colors.white,
                            decoration: dashInput(
                              'Password',
                              icon: Icons.lock,
                              suffix: IconButton(
                                icon: Icon(obscure ? Icons.visibility : Icons.visibility_off, color: Colors.white70),
                                onPressed: () => setState(() => obscure = !obscure),
                              ),
                            ),
                          ),
                          // Remember me: stay signed in after closing the app, and keep the username.
                          Theme(
                            data: Theme.of(context).copyWith(unselectedWidgetColor: Colors.white70),
                            child: CheckboxListTile(
                              value: remember,
                              onChanged: (v) => setState(() => remember = v ?? true),
                              title: const Text('Remember me (မှတ်ထားမည်)', style: TextStyle(color: Colors.white)),
                              controlAffinity: ListTileControlAffinity.leading,
                              contentPadding: EdgeInsets.zero,
                              dense: true,
                              activeColor: Colors.white,
                              checkColor: Dash.ink,
                              side: const BorderSide(color: Colors.white70, width: 1.5),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(30),
                              onTap: busy ? null : _submit,
                              child: Ink(
                                decoration: BoxDecoration(gradient: Dash.highlight, borderRadius: BorderRadius.circular(30)),
                                child: SizedBox(
                                  height: 52,
                                  child: Center(
                                    child: busy
                                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Dash.ink))
                                        : const Row(mainAxisSize: MainAxisSize.min, children: [
                                            Icon(Icons.login, color: Dash.ink),
                                            SizedBox(width: 8),
                                            Text('Login', style: TextStyle(color: Dash.ink, fontSize: 17, fontWeight: FontWeight.w800)),
                                          ]),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ]),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              top: 8,
              right: 12,
              child: GlassIconButton(icon: Icons.settings, tooltip: 'Online Server', onPressed: _editServer),
            ),
          ]),
        ),
      ),
    );
  }
}
