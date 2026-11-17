import 'package:audioplayers/audioplayers.dart';

// Same keypad SFX as the user app (online-mobile). Assets: assets/sounds/.
class SoundService {
  SoundService._();
  static final SoundService instance = SoundService._();

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
      // Best-effort — a missing audio backend must not block typing.
    }
  }

  Future<void> keyPress() => _play(_keyPress, 'sounds/keybuttonpress.wav');
  Future<void> delete() => _play(_delete, 'sounds/recycle.wav');
  Future<void> submit() => _play(_submit, 'sounds/submit.wav');
  Future<void> enter() => _play(_enter, 'sounds/digit_entry.wav');
}
