import 'package:audioplayers/audioplayers.dart';

// Short key-tap sound effects for the Sale screen's pattern keypad drawer (see
// pattern_keypad_sheet.dart) — one AudioPlayer per sound, reused and restarted from the
// beginning on every play instead of created fresh each tap, so rapid key presses stay
// low-latency instead of piling up new player instances. Assets live under assets/sounds/ (see
// pubspec.yaml's assets: entry) and were named to match the desktop app's own sound set
// (client/assets/sounds) where the two overlap (digit_entry, recycle).
class SoundService {
  SoundService._();
  static final SoundService instance = SoundService._();

  // lowLatency mode uses SoundPool on Android instead of MediaPlayer — MediaPlayer (the default)
  // is built for a single long-lived playback session and throws MEDIA_ERROR_UNKNOWN/-SYSTEM when
  // a rapid stop()+play() cycle races its own async prepare, which a keypad tapped quickly runs
  // into almost immediately; SoundPool is the backend actually meant for short, rapid-fire SFX
  // like this and doesn't have that failure mode.
  final AudioPlayer _keyPress = AudioPlayer()
    ..setReleaseMode(ReleaseMode.stop)
    ..setPlayerMode(PlayerMode.lowLatency);
  final AudioPlayer _delete = AudioPlayer()
    ..setReleaseMode(ReleaseMode.stop)
    ..setPlayerMode(PlayerMode.lowLatency);
  final AudioPlayer _submit = AudioPlayer()
    ..setReleaseMode(ReleaseMode.stop)
    ..setPlayerMode(PlayerMode.lowLatency);
  final AudioPlayer _enter = AudioPlayer()
    ..setReleaseMode(ReleaseMode.stop)
    ..setPlayerMode(PlayerMode.lowLatency);

  Future<void> _play(AudioPlayer player, String asset) async {
    try {
      await player.stop();
      await player.play(AssetSource(asset));
    } catch (_) {
      // Best-effort — a missing/unsupported audio backend on some device shouldn't block typing.
    }
  }

  // Every plain key that types into the Number/Unit field — digits, P/B/S/M/T/W/K, *, quick
  // patterns, ကူး (copy last).
  Future<void> keyPress() => _play(_keyPress, 'sounds/keybuttonpress.wav');

  // ဖြတ် (clear field).
  Future<void> delete() => _play(_delete, 'sounds/recycle.wav');

  // ထိုးမည် (adds the typed entry to the cart / long-press submits the whole sale).
  Future<void> submit() => _play(_submit, 'sounds/submit.wav');

  // ENTER.
  Future<void> enter() => _play(_enter, 'sounds/digit_entry.wav');
}
