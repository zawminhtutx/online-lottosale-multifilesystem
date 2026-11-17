import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'services/session.dart';

// Online Lotto — the mobile app for OnlineLotto *user* accounts: same look as the POS mobile app
// (lottery-system/mobile), but every screen reads and writes the OnlineLotto server's API.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session();
  runApp(ChangeNotifierProvider.value(value: session, child: const OnlineLottoApp()));
  await session.load();
}

class OnlineLottoApp extends StatelessWidget {
  const OnlineLottoApp({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'Lotto',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        // The whole app in Poppins Light 300 (bundled; see pubspec.yaml). Myanmar text uses the system font.
        fontFamily: 'Poppins',
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7C3AED)),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF1F5F9),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.white,
          elevation: .5,
          centerTitle: false,
        ),
      ),
      // Signing out (or an expired token) swaps the whole navigator back to Login.
      // Responsive: on tablets / landscape the whole app is a centred column at most 1100 wide,
      // and very large system font sizes are capped so labels and cards don't overflow.
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return ColoredBox(
          color: const Color(0xFFE2E8F0),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1100),
              child: MediaQuery(
                data: media.copyWith(textScaler: media.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.3)),
                child: child ?? const SizedBox.shrink(),
              ),
            ),
          ),
        );
      },
      home: !session.ready
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : session.user == null
              ? const LoginScreen()
              : const HomeShell(),
    );
  }
}
