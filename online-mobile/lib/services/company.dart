import 'api.dart';

// The company name the admin sets (GET /api/settings/company). It heads every slip — printed and
// sent — unless this phone has its own slip heading in the printer settings.
class Company {
  Company._();

  static String name = '';

  // Loaded once the user is signed in; on failure the last known name (or the fallback) is used.
  static Future<void> load() async {
    try {
      final r = await Api.instance.get('/settings/company') as Map;
      name = '${r['company_name'] ?? ''}'.trim();
    } catch (_) {}
  }

  // own: the phone's slip heading (printer settings), empty when not set.
  static String slipHeader([String own = '']) {
    if (own.trim().isNotEmpty) return own.trim();
    return name.isNotEmpty ? name : 'Online Lotto';
  }
}
