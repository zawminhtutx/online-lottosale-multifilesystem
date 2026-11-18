import 'api.dart';

// Thin wrapper — the actual Gemini call is proxied through the backend server so that
// geographic restrictions on direct client access to the Google AI endpoint are bypassed.
class GeminiService {
  static Future<String> translateBets(String text) async {
    final data = await Api.instance.post('/ai/translate-bets', {'text': text});
    return data['result'] as String;
  }
}
