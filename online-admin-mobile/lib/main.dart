import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/session.dart';
import 'widgets/common.dart';

// Online Lotto Admin — the OnlineLotto admin dashboard as a phone app: terms (with Live Ledger,
// unit break, unit per number, results and settle), deposit/withdraw requests, agents and users
// with their wallets, slips and reports. Admin, master and agent accounts all sign in here, each
// with its own background colour and its own screens (see services/session.dart).
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session();
  runApp(ChangeNotifierProvider.value(value: session, child: const AdminApp()));
  await session.load();
}

class AdminApp extends StatelessWidget {
  const AdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    // Admin / master / agent share this app, so the whole theme follows the signed-in role
    // (see RoleLook in widgets/common.dart): indigo, rose, teal.
    final look = lookFor(session.user == null ? 'admin' : session.role);
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'Lotto Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: look.seed),
        useMaterial3: true,
        scaffoldBackgroundColor: look.scaffold,
        appBarTheme: const AppBarTheme(backgroundColor: Colors.white, surfaceTintColor: Colors.white, elevation: .5, centerTitle: false),
      ),
      // Responsive: on tablets / landscape the whole app is a centred column at most 1100 wide,
      // and very large system font sizes are capped so labels and cards don't overflow.
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return ColoredBox(
          color: look.outer,
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
              : const HomeScreen(),
    );
  }
}
