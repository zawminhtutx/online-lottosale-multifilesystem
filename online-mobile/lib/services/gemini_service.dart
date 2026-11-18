import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// Gemini AI — translates pasted Viber / Telegram bet text into the standard format that
// parsePastedBets() can read.  The API key is stored locally per phone in SharedPreferences.
class GeminiService {
  static const _prefKey = 'gemini_api_key';

  static Future<String?> getApiKey() async {
    final p = await SharedPreferences.getInstance();
    final v = p.getString(_prefKey) ?? '';
    return v.isEmpty ? null : v;
  }

  static Future<void> setApiKey(String key) async {
    final p = await SharedPreferences.getInstance();
    final v = key.trim();
    if (v.isEmpty) {
      await p.remove(_prefKey);
    } else {
      await p.setString(_prefKey, v);
    }
  }

  // Returns the first generateContent-capable model available for [apiKey].
  static Future<String> _detectModel(String apiKey) async {
    final url = Uri.parse(
      'https://generativelanguage.googleapis.com/v1beta/models?key=$apiKey',
    );
    final resp = await http.get(url).timeout(const Duration(seconds: 15));
    if (resp.statusCode != 200) {
      String detail = resp.body;
      try {
        final j = jsonDecode(resp.body) as Map;
        detail = (j['error'] as Map?)?['message'] as String? ?? resp.body;
      } catch (_) {}
      throw Exception('Gemini API key မမှန်ပါ (${resp.statusCode}): $detail');
    }
    final models = (jsonDecode(resp.body) as Map)['models'] as List? ?? [];
    // Prefer flash/pro generative models in order of preference.
    const preferred = [
      'gemini-1.5-flash', 'gemini-1.5-pro',
      'gemini-1.0-pro', 'gemini-pro',
      'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    ];
    for (final want in preferred) {
      for (final m in models) {
        final name = (m as Map)['name'] as String? ?? '';
        final methods = (m['supportedGenerationMethods'] as List?) ?? [];
        if (name.contains(want) && methods.contains('generateContent')) {
          // name is like "models/gemini-1.5-flash" — strip the prefix.
          return name.replaceFirst('models/', '');
        }
      }
    }
    // Fallback: pick the first model that supports generateContent.
    for (final m in models) {
      final name = (m as Map)['name'] as String? ?? '';
      final methods = (m['supportedGenerationMethods'] as List?) ?? [];
      if (methods.contains('generateContent')) {
        return name.replaceFirst('models/', '');
      }
    }
    throw Exception('ဤ API key မှ generateContent ပံ့ပိုးသော model မတွေ့ပါ');
  }

  // Sends [text] to Gemini and returns the formatted bet lines.
  // Throws if the key is missing or the request fails.
  static Future<String> translateBets(String text) async {
    final apiKey = await getApiKey();
    if (apiKey == null) throw Exception('Settings မှာ Gemini API key ထည့်ပါ');

    final model = await _detectModel(apiKey);

    const prompt =
        'You are a Myanmar 2D/3D lottery bet text parser.\n'
        'Convert the following Viber/Telegram message to standard bet format.\n\n'
        'Rules:\n'
        '- Each bet on its own line: [number_or_pattern] [units]\n'
        '- 2-digit numbers 00–99; "25R 500" for reverse; "R 3000" as R-header\n'
        '- Units are plain integers (remove ks/ကျပ် suffix)\n'
        '- Myanmar digits ၀၁၂၃၄၅၆၇၈၉ → 0123456789\n'
        '- Strip greetings, dates, names, totals, section headers\n'
        '- Output ONLY the converted bet lines. No explanation.\n\n'
        'Input:\n';

    final url = Uri.parse(
      'https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey',
    );
    final resp = await http
        .post(
          url,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'contents': [
              {
                'parts': [
                  {'text': '$prompt$text'}
                ]
              }
            ],
          }),
        )
        .timeout(const Duration(seconds: 20));

    if (resp.statusCode != 200) {
      String detail = resp.body;
      try {
        final j = jsonDecode(resp.body) as Map;
        detail = (j['error'] as Map?)?['message'] as String? ?? resp.body;
      } catch (_) {}
      throw Exception('Gemini ${resp.statusCode} ($model): $detail');
    }
    final json = jsonDecode(resp.body) as Map;
    final parts = ((json['candidates'] as List?)?.firstOrNull?['content']
        as Map?)?['parts'] as List?;
    final result = (parts?.firstOrNull?['text'] as String? ?? '').trim();
    if (result.isEmpty) throw Exception('Gemini မှ ဖြေ မရပါ');
    return result;
  }
}
